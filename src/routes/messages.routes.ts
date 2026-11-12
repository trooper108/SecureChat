import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { expressAuthMiddleware } from '../middleware/auth';
import { MessageModel } from '../models/message.model';

export const messagesRouter = Router();

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime().optional()
});

// GET /messages/:peerId - Fetch paginated chat history with a peer
messagesRouter.get('/messages/:peerId', expressAuthMiddleware, async (req: Request, res: Response) => {
  const currentUserId = req.user!.userId;
  const peerId = req.params.peerId;

  if (!peerId) {
    res.status(400).json({ error: 'Bad Request', message: 'peerId parameter is required' });
    return;
  }

  const queryResult = historyQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    res.status(400).json({
      error: 'Bad Request',
      message: queryResult.error.errors.map((e) => e.message).join('; ')
    });
    return;
  }

  const { page, limit, before } = queryResult.data;
  const skip = (page - 1) * limit;

  const filter: any = {
    $or: [
      { from: currentUserId, to: peerId },
      { from: peerId, to: currentUserId }
    ]
  };

  if (before) {
    filter.createdAt = { $lt: new Date(before) };
  }

  const [total, docs] = await Promise.all([
    MessageModel.countDocuments(filter),
    MessageModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
  ]);

  const messages = docs.map((doc) => ({
    id: doc._id.toString(),
    from: doc.from,
    to: doc.to,
    ciphertext: doc.ciphertext,
    iv: doc.iv,
    createdAt: doc.createdAt,
    deliveredAt: doc.deliveredAt
  }));

  const totalPages = Math.ceil(total / limit);

  res.status(200).json({
    messages,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasMore: page < totalPages
    }
  });
});
