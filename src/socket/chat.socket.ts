import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { socketAuthMiddleware } from '../middleware/auth';
import { presenceService } from '../services/presence.service';
import { checkMessageRateLimit } from '../services/rateLimiter';
import { MessageModel } from '../models/message.model';
import { logger } from '../config/logger';
import { getEnv } from '../config/env';

const sendMessageSchema = z.object({
  to: z.string().min(1, 'Recipient ID (to) is required'),
  ciphertext: z.string().min(1, 'Ciphertext is required'),
  iv: z.string().min(1, 'IV is required')
});

const deliveredSchema = z.object({
  messageId: z.string().min(1, 'messageId is required')
});

const typingSchema = z.object({
  to: z.string().min(1, 'Recipient ID (to) is required'),
  isTyping: z.boolean().default(true)
});

export function setupSocketServer(httpServer: HttpServer): Server {
  const env = getEnv();

  const io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN.split(','),
      credentials: true
    }
  });

  // Authenticate every socket connection
  io.use(socketAuthMiddleware);

  io.on('connection', async (socket: Socket) => {
    const userId = socket.data.userId as string;

    // Join private room dedicated to this user across all their sockets
    socket.join(`user:${userId}`);

    // Update presence in Redis
    await presenceService.setUserOnline(userId, socket.id);
    socket.broadcast.emit('presence:update', { userId, status: 'online' });

    // Deliver pending offline messages
    try {
      const pendingMessages = await MessageModel.find({
        to: userId,
        deliveredAt: null
      }).sort({ createdAt: 1 });

      for (const msg of pendingMessages) {
        const deliveredAt = new Date();
        msg.deliveredAt = deliveredAt;
        await msg.save();

        // Deliver to recipient
        socket.emit('message:new', {
          id: msg._id.toString(),
          from: msg.from,
          to: msg.to,
          ciphertext: msg.ciphertext,
          iv: msg.iv,
          createdAt: msg.createdAt,
          deliveredAt
        });

        // Notify sender about delivery
        io.to(`user:${msg.from}`).emit('message:delivered', {
          messageId: msg._id.toString(),
          to: userId,
          deliveredAt
        });
      }
    } catch (err: any) {
      logger.error({ err: err.message, userId }, 'Error delivering offline messages on reconnect');
    }

    // message:send event
    socket.on('message:send', async (data: any, ack?: (response: any) => void) => {
      const parseResult = sendMessageSchema.safeParse(data);
      if (!parseResult.success) {
        const errorMsg = parseResult.error.errors.map((e) => e.message).join('; ');
        socket.emit('error', { event: 'message:send', message: errorMsg });
        ack?.({ status: 'error', error: errorMsg });
        return;
      }

      const { to, ciphertext, iv } = parseResult.data;
      if (to === userId) {
        const errorMsg = 'Cannot send message to yourself';
        socket.emit('error', { event: 'message:send', message: errorMsg });
        ack?.({ status: 'error', error: errorMsg });
        return;
      }

      // Redis-backed rate limiting per user
      const rateLimit = await checkMessageRateLimit(userId);
      if (!rateLimit.allowed) {
        const errorMsg = `Rate limit exceeded. Maximum ${rateLimit.limit} messages allowed per window.`;
        socket.emit('error', { event: 'message:send', message: errorMsg });
        ack?.({ status: 'error', error: errorMsg, code: 'RATE_LIMIT_EXCEEDED' });
        return;
      }

      try {
        const isRecipientOnline = await presenceService.isUserOnline(to);

        if (isRecipientOnline) {
          const deliveredAt = new Date();
          const message = await MessageModel.create({
            from: userId,
            to,
            ciphertext,
            iv,
            createdAt: new Date(),
            deliveredAt
          });

          const messagePayload = {
            id: message._id.toString(),
            from: userId,
            to,
            ciphertext,
            iv,
            createdAt: message.createdAt,
            deliveredAt
          };

          // Emit to recipient's user room
          io.to(`user:${to}`).emit('message:new', messagePayload);

          // Emit delivery confirmation back to sender
          socket.emit('message:delivered', {
            messageId: message._id.toString(),
            to,
            deliveredAt
          });

          ack?.({
            status: 'delivered',
            messageId: message._id.toString(),
            deliveredAt
          });
        } else {
          // Recipient is offline: store with deliveredAt = null
          const message = await MessageModel.create({
            from: userId,
            to,
            ciphertext,
            iv,
            createdAt: new Date(),
            deliveredAt: null
          });

          ack?.({
            status: 'queued',
            messageId: message._id.toString(),
            deliveredAt: null
          });
        }
      } catch (err: any) {
        logger.error({ err: err.message, from: userId, to }, 'Error persisting chat message');
        socket.emit('error', { event: 'message:send', message: 'Failed to process message' });
        ack?.({ status: 'error', error: 'Internal server error' });
      }
    });

    // Explicit message:delivered acknowledgment from recipient
    socket.on('message:delivered', async (data: any) => {
      const parseResult = deliveredSchema.safeParse(data);
      if (!parseResult.success) return;

      const { messageId } = parseResult.data;
      try {
        const message = await MessageModel.findOne({ _id: messageId, to: userId });
        if (message && !message.deliveredAt) {
          message.deliveredAt = new Date();
          await message.save();

          io.to(`user:${message.from}`).emit('message:delivered', {
            messageId: message._id.toString(),
            to: userId,
            deliveredAt: message.deliveredAt
          });
        }
      } catch (err: any) {
        logger.error({ err: err.message, messageId }, 'Error updating deliveredAt');
      }
    });

    // Typing indicators
    socket.on('typing', (data: any) => {
      const parseResult = typingSchema.safeParse(data);
      if (parseResult.success) {
        io.to(`user:${parseResult.data.to}`).emit('typing', {
          from: userId,
          isTyping: parseResult.data.isTyping
        });
      }
    });

    socket.on('typing:start', (data: any) => {
      if (data?.to && typeof data.to === 'string') {
        io.to(`user:${data.to}`).emit('typing', {
          from: userId,
          isTyping: true
        });
      }
    });

    socket.on('typing:stop', (data: any) => {
      if (data?.to && typeof data.to === 'string') {
        io.to(`user:${data.to}`).emit('typing', {
          from: userId,
          isTyping: false
        });
      }
    });

    // Handle disconnect
    socket.on('disconnect', async () => {
      await presenceService.setUserOffline(userId, socket.id);
      const isStillOnline = await presenceService.isUserOnline(userId);
      if (!isStillOnline) {
        socket.broadcast.emit('presence:update', { userId, status: 'offline' });
      }
    });
  });

  return io;
}
