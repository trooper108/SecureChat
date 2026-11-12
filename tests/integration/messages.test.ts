import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../../src/app';
import { setupTestEnvironment, cleanupTestEnvironment } from '../helpers/testDb';
import { getEnv } from '../../src/config/env';
import { MessageModel } from '../../src/models/message.model';

describe('Messages History API', () => {
  let app: any;
  const env = getEnv();
  const aliceId = 'user_alice_history';
  const bobId = 'user_bob_history';
  const charlieId = 'user_charlie_history';

  const aliceToken = jwt.sign({ sub: aliceId }, env.JWT_ACCESS_SECRET, { algorithm: 'HS256' });

  beforeAll(async () => {
    await setupTestEnvironment();
    app = createApp();

    // Seed messages between Alice and Bob
    const baseTime = new Date('2026-01-01T10:00:00.000Z').getTime();

    const messages = [
      {
        from: aliceId,
        to: bobId,
        ciphertext: 'base64_encrypted_payload_1',
        iv: 'iv_payload_1',
        createdAt: new Date(baseTime + 1000),
        deliveredAt: new Date(baseTime + 1500)
      },
      {
        from: bobId,
        to: aliceId,
        ciphertext: 'base64_encrypted_payload_2',
        iv: 'iv_payload_2',
        createdAt: new Date(baseTime + 2000),
        deliveredAt: new Date(baseTime + 2500)
      },
      {
        from: aliceId,
        to: bobId,
        ciphertext: 'base64_encrypted_payload_3',
        iv: 'iv_payload_3',
        createdAt: new Date(baseTime + 3000),
        deliveredAt: null // Undelivered/offline message
      },
      // Message between Alice and Charlie (must NOT show in Alice-Bob history)
      {
        from: aliceId,
        to: charlieId,
        ciphertext: 'alice_to_charlie',
        iv: 'iv_charlie',
        createdAt: new Date(baseTime + 4000),
        deliveredAt: null
      }
    ];

    await MessageModel.insertMany(messages);
  });

  afterAll(async () => {
    await cleanupTestEnvironment();
  });

  it('should reject unauthenticated request', async () => {
    const res = await request(app).get(`/messages/${bobId}`);
    expect(res.status).toBe(401);
  });

  it('should return paginated message history strictly between Alice and Bob', async () => {
    const res = await request(app)
      .get(`/messages/${bobId}`)
      .set('Authorization', `Bearer ${aliceToken}`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(3);
    expect(res.body.pagination.total).toBe(3);
    expect(res.body.pagination.page).toBe(1);

    // Verify ordering is newest first
    expect(res.body.messages[0].ciphertext).toBe('base64_encrypted_payload_3');
    expect(res.body.messages[1].ciphertext).toBe('base64_encrypted_payload_2');
    expect(res.body.messages[2].ciphertext).toBe('base64_encrypted_payload_1');

    // Verify fields
    expect(res.body.messages[0].iv).toBe('iv_payload_3');
    expect(res.body.messages[0].deliveredAt).toBeNull();
    expect(res.body.messages[1].deliveredAt).toBeDefined();
  });

  it('should support pagination with limit and page', async () => {
    const page1Res = await request(app)
      .get(`/messages/${bobId}?page=1&limit=2`)
      .set('Authorization', `Bearer ${aliceToken}`);

    expect(page1Res.status).toBe(200);
    expect(page1Res.body.messages).toHaveLength(2);
    expect(page1Res.body.pagination.totalPages).toBe(2);
    expect(page1Res.body.pagination.hasMore).toBe(true);

    const page2Res = await request(app)
      .get(`/messages/${bobId}?page=2&limit=2`)
      .set('Authorization', `Bearer ${aliceToken}`);

    expect(page2Res.status).toBe(200);
    expect(page2Res.body.messages).toHaveLength(1);
    expect(page2Res.body.pagination.hasMore).toBe(false);
  });

  it('should support before cursor timestamp', async () => {
    const beforeDate = new Date('2026-01-01T10:00:02.500Z').toISOString();

    const res = await request(app)
      .get(`/messages/${bobId}?before=${encodeURIComponent(beforeDate)}`)
      .set('Authorization', `Bearer ${aliceToken}`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages[0].ciphertext).toBe('base64_encrypted_payload_2');
  });
});
