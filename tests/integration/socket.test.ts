import http from 'http';
import { AddressInfo } from 'net';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { createServer } from '../../src/server';
import { setupTestEnvironment, cleanupTestEnvironment } from '../helpers/testDb';
import { getEnv } from '../../src/config/env';
import { MessageModel } from '../../src/models/message.model';
import { presenceService } from '../../src/services/presence.service';

describe('Real-time Socket.io Chat, Presence, Rate Limiting & Offline Delivery', () => {
  let httpServer: http.Server;
  let serverPort: number;
  const env = getEnv();

  const userAlice = 'user_alice_socket';
  const userBob = 'user_bob_socket';
  const userCharlie = 'user_charlie_socket';

  const aliceToken = jwt.sign({ sub: userAlice }, env.JWT_ACCESS_SECRET, { algorithm: 'HS256' });
  const bobToken = jwt.sign({ sub: userBob }, env.JWT_ACCESS_SECRET, { algorithm: 'HS256' });
  const charlieToken = jwt.sign({ sub: userCharlie }, env.JWT_ACCESS_SECRET, { algorithm: 'HS256' });

  function createClient(token?: string): ClientSocketType {
    return ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: token ? { token } : undefined,
      transports: ['websocket'],
      autoConnect: false
    });
  }

  beforeAll(async () => {
    await setupTestEnvironment();
    const serverInstance = createServer();
    httpServer = serverInstance.httpServer;

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        serverPort = (httpServer.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await cleanupTestEnvironment();
  });

  describe('Handshake Authentication', () => {
    it('should reject connection without token', (done) => {
      const client = createClient();
      client.connect();

      client.on('connect_error', (err) => {
        expect(err.message).toContain('Missing access token');
        client.disconnect();
        done();
      });
    });

    it('should reject connection with invalid token', (done) => {
      const client = createClient('invalid.token.string');
      client.connect();

      client.on('connect_error', (err) => {
        expect(err.message).toContain('Invalid or expired access token');
        client.disconnect();
        done();
      });
    });

    it('should connect successfully with valid token', (done) => {
      const client = createClient(aliceToken);
      client.connect();

      client.on('connect', () => {
        expect(client.connected).toBe(true);
        client.disconnect();
        done();
      });
    });
  });

  describe('Presence Tracking in Redis', () => {
    it('should store user presence online when connected and offline when disconnected', (done) => {
      const client = createClient(aliceToken);
      client.connect();

      client.on('connect', async () => {
        // Alice should be marked online in Redis
        const isOnline = await presenceService.isUserOnline(userAlice);
        expect(isOnline).toBe(true);

        client.disconnect();

        // Brief delay for disconnect event processing
        setTimeout(async () => {
          const isStillOnline = await presenceService.isUserOnline(userAlice);
          expect(isStillOnline).toBe(false);
          done();
        }, 100);
      });
    });
  });

  describe('Real-time 1-to-1 Messaging & Typing', () => {
    let aliceClient: ClientSocketType;
    let bobClient: ClientSocketType;

    beforeEach((done) => {
      aliceClient = createClient(aliceToken);
      bobClient = createClient(bobToken);

      let connectedCount = 0;
      const checkDone = () => {
        connectedCount += 1;
        if (connectedCount === 2) done();
      };

      aliceClient.on('connect', checkDone);
      bobClient.on('connect', checkDone);

      aliceClient.connect();
      bobClient.connect();
    });

    afterEach(() => {
      if (aliceClient.connected) aliceClient.disconnect();
      if (bobClient.connected) bobClient.disconnect();
    });

    it('should deliver message in real time to online receiver and confirm delivery to sender', (done) => {
      const testCiphertext = 'aes_256_gcm_ciphertext_sample';
      const testIv = 'random_12_byte_iv';

      let messageDeliveredReceived = false;
      let messageNewReceived = false;

      const maybeFinish = () => {
        if (messageDeliveredReceived && messageNewReceived) {
          done();
        }
      };

      // Bob listens for new message
      bobClient.on('message:new', (msg) => {
        expect(msg.from).toBe(userAlice);
        expect(msg.to).toBe(userBob);
        expect(msg.ciphertext).toBe(testCiphertext);
        expect(msg.iv).toBe(testIv);
        expect(msg.deliveredAt).toBeDefined();
        messageNewReceived = true;
        maybeFinish();
      });

      // Alice listens for delivery confirmation
      aliceClient.on('message:delivered', async (delivery) => {
        expect(delivery.to).toBe(userBob);
        expect(delivery.deliveredAt).toBeDefined();

        // Verify MongoDB record
        const saved = await MessageModel.findById(delivery.messageId);
        expect(saved).toBeDefined();
        expect(saved?.ciphertext).toBe(testCiphertext);
        expect(saved?.deliveredAt).toBeDefined();

        messageDeliveredReceived = true;
        maybeFinish();
      });

      // Alice sends message
      aliceClient.emit('message:send', {
        to: userBob,
        ciphertext: testCiphertext,
        iv: testIv
      });
    });

    it('should forward typing indicators to recipient', (done) => {
      bobClient.on('typing', (data) => {
        expect(data.from).toBe(userAlice);
        expect(data.isTyping).toBe(true);
        done();
      });

      aliceClient.emit('typing', { to: userBob, isTyping: true });
    });
  });

  describe('Offline Delivery on Reconnect', () => {
    let aliceClient: ClientSocketType;

    beforeEach((done) => {
      aliceClient = createClient(aliceToken);
      aliceClient.on('connect', done);
      aliceClient.connect();
    });

    afterEach(() => {
      if (aliceClient.connected) aliceClient.disconnect();
    });

    it('should queue message when recipient is offline and deliver upon reconnect', async () => {
      // Charlie is offline
      expect(await presenceService.isUserOnline(userCharlie)).toBe(false);

      const offlineCiphertext = 'ciphertext_for_offline_charlie';
      const offlineIv = 'iv_for_offline_charlie';

      // Alice sends message to offline Charlie
      await new Promise<void>((resolve) => {
        aliceClient.emit(
          'message:send',
          { to: userCharlie, ciphertext: offlineCiphertext, iv: offlineIv },
          async (ack: any) => {
            expect(ack.status).toBe('queued');
            expect(ack.deliveredAt).toBeNull();
            resolve();
          }
        );
      });

      // Verify message is saved in MongoDB with deliveredAt = null
      const queuedMessage = await MessageModel.findOne({
        from: userAlice,
        to: userCharlie,
        ciphertext: offlineCiphertext
      });
      expect(queuedMessage).toBeDefined();
      expect(queuedMessage?.deliveredAt).toBeNull();

      // Now Charlie connects to the chat
      const charlieClient = createClient(charlieToken);

      await new Promise<void>((resolve) => {
        // Charlie should receive the pending message immediately on connect
        charlieClient.on('message:new', async (msg) => {
          expect(msg.from).toBe(userAlice);
          expect(msg.to).toBe(userCharlie);
          expect(msg.ciphertext).toBe(offlineCiphertext);
          expect(msg.deliveredAt).toBeDefined();

          // Check that MongoDB updated deliveredAt
          const updated = await MessageModel.findById(msg.id);
          expect(updated?.deliveredAt).toBeDefined();

          charlieClient.disconnect();
          resolve();
        });

        charlieClient.connect();
      });
    });
  });

  describe('Redis-backed Rate Limiting on message:send', () => {
    let rateLimitedClient: ClientSocketType;
    const rateLimitedUser = 'user_rate_limited_tester';
    const rateLimitedToken = jwt.sign({ sub: rateLimitedUser }, env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256'
    });

    beforeEach((done) => {
      rateLimitedClient = createClient(rateLimitedToken);
      rateLimitedClient.on('connect', done);
      rateLimitedClient.connect();
    });

    afterEach(() => {
      if (rateLimitedClient.connected) rateLimitedClient.disconnect();
    });

    it('should enforce rate limits on message:send per user', async () => {
      const burstCount = env.MESSAGE_RATE_LIMIT_MAX + 5;
      const responses: any[] = [];

      for (let i = 0; i < burstCount; i++) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => {
          rateLimitedClient.emit(
            'message:send',
            {
              to: userBob,
              ciphertext: `burst_ciphertext_${i}`,
              iv: `burst_iv_${i}`
            },
            (ack: any) => {
              responses.push(ack);
              resolve();
            }
          );
        });
      }

      // First env.MESSAGE_RATE_LIMIT_MAX should succeed
      const successful = responses.filter((r) => r.status === 'queued' || r.status === 'delivered');
      const rateLimited = responses.filter((r) => r.code === 'RATE_LIMIT_EXCEEDED');

      expect(successful.length).toBe(env.MESSAGE_RATE_LIMIT_MAX);
      expect(rateLimited.length).toBe(5);
    });
  });
});
