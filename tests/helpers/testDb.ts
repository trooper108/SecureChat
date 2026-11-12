import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import RedisMock from 'ioredis-mock';
import { setRedisClient } from '../../src/config/redis';

let mongoServer: MongoMemoryServer | null = null;
let mockRedis: any = null;

export async function setupTestEnvironment(): Promise<{ mongoUri: string; redis: any }> {
  // Start in-memory MongoDB
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);

  // Set up mock Redis
  mockRedis = new RedisMock();
  setRedisClient(mockRedis);

  return { mongoUri, redis: mockRedis };
}

export async function cleanupTestEnvironment(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    if (mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await mongoose.disconnect();
  }

  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }

  if (mockRedis) {
    await mockRedis.flushall();
    setRedisClient(null);
    mockRedis = null;
  }
}
