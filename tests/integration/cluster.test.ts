import http from 'http';
import { AddressInfo } from 'net';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import RedisMock from 'ioredis-mock';
import { createServer } from '../../src/server';
import { setupTestEnvironment, cleanupTestEnvironment } from '../helpers/testDb';
import { getEnv } from '../../src/config/env';
import { MessageModel } from '../../src/models/message.model';

describe('Multi-Instance Horizontal Scaling with Redis Adapter', () => {
  let serverA: http.Server;
  let serverB: http.Server;
  let ioA: SocketServer;
  let ioB: SocketServer;
  let portA: number;
  let portB: number;

  const env = getEnv();
  const aliceId = 'user_alice_instance_a';
  const bobId = 'user_bob_instance_b';

  const aliceToken = jwt.sign({ sub: aliceId }, env.JWT_ACCESS_SECRET, { algorithm: 'HS256' });
  const bobToken = jwt.sign({ sub: bobId }, env.JWT_ACCESS_SECRET, { algorithm: 'HS256' });

  beforeAll(async () => {
    await setupTestEnvironment();

    // Shared mock Redis data store for cluster pub/sub and presence
    const sharedData = {};
    const clusterRedis = new RedisMock({ data: sharedData });
    const { setRedisClient } = await import('../../src/config/redis');
    setRedisClient(clusterRedis);

    const pubA = new RedisMock({ data: sharedData });
    const subA = new RedisMock({ data: sharedData });
    const pubB = new RedisMock({ data: sharedData });
    const subB = new RedisMock({ data: sharedData });

    // Server Instance A
    const instanceA = createServer({ pubClient: pubA, subClient: subA });
    serverA = instanceA.httpServer;
    ioA = instanceA.io;
    await new Promise<void>((resolve) => {
      serverA.listen(0, () => {
        portA = (serverA.address() as AddressInfo).port;
        resolve();
      });
    });

    // Server Instance B
    const instanceB = createServer({ pubClient: pubB, subClient: subB });
    serverB = instanceB.httpServer;
    ioB = instanceB.io;
    await new Promise<void>((resolve) => {
      serverB.listen(0, () => {
        portB = (serverB.address() as AddressInfo).port;
        resolve();
      });
    });

    // Ensure instances run on different ports
    expect(portA).not.toBe(portB);
  });

  afterAll(async () => {
    await Promise.all([
      new Promise<void>((res) => ioA.close(() => res())),
      new Promise<void>((res) => ioB.close(() => res()))
    ]);
    await Promise.all([
      new Promise<void>((res) => serverA.close(() => res())),
      new Promise<void>((res) => serverB.close(() => res()))
    ]);
    await cleanupTestEnvironment();
  });

  it('proves a message sent via Instance A reaches a user connected to Instance B', async () => {
    // Connect Alice to Instance A
    const clientAlice: ClientSocketType = ClientSocket(`http://127.0.0.1:${portA}`, {
      auth: { token: aliceToken },
      transports: ['websocket'],
      autoConnect: false
    });

    // Connect Bob to Instance B
    const clientBob: ClientSocketType = ClientSocket(`http://127.0.0.1:${portB}`, {
      auth: { token: bobToken },
      transports: ['websocket'],
      autoConnect: false
    });

    await Promise.all([
      new Promise<void>((resolve) => {
        clientAlice.on('connect', () => resolve());
        clientAlice.connect();
      }),
      new Promise<void>((resolve) => {
        clientBob.on('connect', () => resolve());
        clientBob.connect();
      })
    ]);

    expect(clientAlice.connected).toBe(true);
    expect(clientBob.connected).toBe(true);

    // Allow a brief moment for async server-side room joins and presence registration
    await new Promise((resolve) => setTimeout(resolve, 200));

    const testCiphertext = 'ciphertext_cluster_cross_instance_test';
    const testIv = 'random_iv_12_bytes_cluster';

    // Bob on Instance B listens for message emitted across Redis adapter
    const messageNewPromise = new Promise<any>((resolve) => {
      clientBob.on('message:new', (msg) => {
        resolve(msg);
      });
    });

    // Alice on Instance A listens for delivery receipt
    const deliveryPromise = new Promise<any>((resolve) => {
      clientAlice.on('message:delivered', (receipt) => {
        resolve(receipt);
      });
    });

    // Alice sends message via Instance A to Bob (who is connected to Instance B)
    clientAlice.emit('message:send', {
      to: bobId,
      ciphertext: testCiphertext,
      iv: testIv
    });

    const [receivedMsg, deliveryReceipt] = await Promise.all([
      messageNewPromise,
      deliveryPromise
    ]);

    // Verify Bob on Instance B received Alice's message correctly
    expect(receivedMsg).toBeDefined();
    expect(receivedMsg.from).toBe(aliceId);
    expect(receivedMsg.to).toBe(bobId);
    expect(receivedMsg.ciphertext).toBe(testCiphertext);
    expect(receivedMsg.iv).toBe(testIv);
    expect(receivedMsg.deliveredAt).toBeDefined();

    // Verify Alice on Instance A received delivery receipt
    expect(deliveryReceipt).toBeDefined();
    expect(deliveryReceipt.to).toBe(bobId);
    expect(deliveryReceipt.deliveredAt).toBeDefined();

    // Verify database record
    const dbRecord = await MessageModel.findById(receivedMsg.id);
    expect(dbRecord).toBeDefined();
    expect(dbRecord?.ciphertext).toBe(testCiphertext);
    expect(dbRecord?.deliveredAt).toBeDefined();

    clientAlice.disconnect();
    clientBob.disconnect();
  });

  it('proves typing indicators propagate across instances via Redis adapter', async () => {
    const clientAlice: ClientSocketType = ClientSocket(`http://127.0.0.1:${portA}`, {
      auth: { token: aliceToken },
      transports: ['websocket'],
      autoConnect: false
    });

    const clientBob: ClientSocketType = ClientSocket(`http://127.0.0.1:${portB}`, {
      auth: { token: bobToken },
      transports: ['websocket'],
      autoConnect: false
    });

    await Promise.all([
      new Promise<void>((res) => {
        clientAlice.on('connect', res);
        clientAlice.connect();
      }),
      new Promise<void>((res) => {
        clientBob.on('connect', res);
        clientBob.connect();
      })
    ]);

    const typingPromise = new Promise<any>((resolve) => {
      clientBob.on('typing', (data) => {
        resolve(data);
      });
    });

    // Alice on Instance A starts typing to Bob on Instance B
    clientAlice.emit('typing', { to: bobId, isTyping: true });

    const typingData = await typingPromise;
    expect(typingData.from).toBe(aliceId);
    expect(typingData.isTyping).toBe(true);

    clientAlice.disconnect();
    clientBob.disconnect();
  });
});
