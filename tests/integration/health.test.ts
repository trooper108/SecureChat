import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../../src/app';
import { setupTestEnvironment, cleanupTestEnvironment } from '../helpers/testDb';
import { setRedisClient } from '../../src/config/redis';

describe('GET /health endpoint', () => {
  let app: any;
  let mockRedis: any;

  beforeAll(async () => {
    const env = await setupTestEnvironment();
    mockRedis = env.redis;
    app = createApp();
  });

  afterAll(async () => {
    await cleanupTestEnvironment();
  });

  it('should return 200 when both MongoDB and Redis are connected', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.services.mongodb).toBe('connected');
    expect(response.body.services.redis).toBe('connected');
    expect(response.body.timestamp).toBeDefined();
  });

  it('should return 503 when Redis is disconnected', async () => {
    // Provide a redis client whose ping fails
    const failingRedis = {
      ping: jest.fn().mockRejectedValue(new Error('Redis connection lost'))
    };
    setRedisClient(failingRedis as any);

    const response = await request(app).get('/health');
    expect(response.status).toBe(503);
    expect(response.body.status).toBe('degraded');
    expect(response.body.services.redis).toBe('disconnected');
    expect(response.body.services.mongodb).toBe('connected');

    // Restore working mock redis
    setRedisClient(mockRedis);
  });

  it('should return 503 when MongoDB is disconnected', async () => {
    // Temporarily disconnect mongoose
    await mongoose.disconnect();

    const response = await request(app).get('/health');
    expect(response.status).toBe(503);
    expect(response.body.status).toBe('degraded');
    expect(response.body.services.mongodb).toBe('disconnected');
  });
});
