import Redis, { RedisOptions } from 'ioredis';
import { logger } from './logger';
import { getEnv } from './env';

let redisInstance: Redis | null = null;

export function createRedisClient(customUrl?: string, customOptions?: RedisOptions): Redis {
  const env = getEnv();
  const redisUrl = customUrl || env.REDIS_URL;
  const isTls = redisUrl.startsWith('rediss://');

  const options: RedisOptions = {
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      // Exponential backoff capped at 3 seconds
      return Math.min(times * 200, 3000);
    },
    ...customOptions
  };

  if (isTls && !options.tls) {
    options.tls = {};
  }

  const client = new Redis(redisUrl, options);

  // Prevent process crash on Redis connection errors
  client.on('error', (err) => {
    logger.error({ err: err.message }, 'Redis connection error');
  });

  client.on('connect', () => {
    logger.info('Connected to Redis');
  });

  client.on('close', () => {
    logger.warn('Redis connection closed');
  });

  return client;
}

export function getRedisClient(): Redis {
  if (!redisInstance) {
    redisInstance = createRedisClient();
  }
  return redisInstance;
}

export function setRedisClient(client: Redis | null): void {
  redisInstance = client;
}

export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    try {
      await redisInstance.quit();
    } catch {
      redisInstance.disconnect();
    } finally {
      redisInstance = null;
    }
  }
}
