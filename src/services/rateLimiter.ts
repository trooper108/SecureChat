import { getRedisClient } from '../config/redis';
import { getEnv } from '../config/env';
import { logger } from '../config/logger';

export interface RateLimitResult {
  allowed: boolean;
  current: number;
  limit: number;
}

export async function checkMessageRateLimit(
  userId: string,
  customLimit?: number,
  customWindowSecs?: number
): Promise<RateLimitResult> {
  const env = getEnv();
  const limit = customLimit ?? env.MESSAGE_RATE_LIMIT_MAX;
  const windowSecs = customWindowSecs ?? env.MESSAGE_RATE_LIMIT_WINDOW_SECS;
  const key = `ratelimit:messages:${userId}`;

  try {
    const redis = getRedisClient();
    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, windowSecs);
    }

    if (current > limit) {
      return {
        allowed: false,
        current,
        limit
      };
    }

    return {
      allowed: true,
      current,
      limit
    };
  } catch (err: any) {
    // Fail-open: Redis connection errors must be logged, never crash or block messages
    logger.error({ err: err.message, userId }, 'Redis error during rate limiting check');
    return {
      allowed: true,
      current: 1,
      limit
    };
  }
}
