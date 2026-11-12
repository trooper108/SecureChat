import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { getRedisClient } from '../config/redis';

export const healthRouter = Router();

healthRouter.get('/health', async (_req: Request, res: Response) => {
  let mongoStatus = 'disconnected';
  if (mongoose.connection.readyState === 1) {
    mongoStatus = 'connected';
  }

  let redisStatus = 'disconnected';
  try {
    const redis = getRedisClient();
    // Ping with a 1-second timeout
    const pong = await Promise.race([
      redis.ping(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
    ]);
    if (pong === 'PONG') {
      redisStatus = 'connected';
    }
  } catch {
    redisStatus = 'disconnected';
  }

  const isHealthy = mongoStatus === 'connected' && redisStatus === 'connected';
  const statusCode = isHealthy ? 200 : 503;

  res.status(statusCode).json({
    status: isHealthy ? 'ok' : 'degraded',
    services: {
      mongodb: mongoStatus,
      redis: redisStatus
    },
    timestamp: new Date().toISOString()
  });
});
