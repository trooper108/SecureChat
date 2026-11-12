import { getRedisClient } from '../config/redis';
import { logger } from '../config/logger';

export class PresenceService {
  private static userSocketsKey(userId: string): string {
    return `user:sockets:${userId}`;
  }

  private static onlineUsersKey(): string {
    return 'presence:online_users';
  }

  async setUserOnline(userId: string, socketId: string): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.sadd(PresenceService.userSocketsKey(userId), socketId);
      await redis.sadd(PresenceService.onlineUsersKey(), userId);
    } catch (err: any) {
      logger.error({ err: err.message, userId, socketId }, 'Redis error setting user online');
    }
  }

  async setUserOffline(userId: string, socketId: string): Promise<void> {
    try {
      const redis = getRedisClient();
      const socketKey = PresenceService.userSocketsKey(userId);
      await redis.srem(socketKey, socketId);
      const remaining = await redis.scard(socketKey);
      if (remaining === 0) {
        await redis.srem(PresenceService.onlineUsersKey(), userId);
      }
    } catch (err: any) {
      logger.error({ err: err.message, userId, socketId }, 'Redis error setting user offline');
    }
  }

  async isUserOnline(userId: string): Promise<boolean> {
    try {
      const redis = getRedisClient();
      const isMember = await redis.sismember(PresenceService.onlineUsersKey(), userId);
      return isMember === 1;
    } catch (err: any) {
      logger.error({ err: err.message, userId }, 'Redis error checking user presence');
      return false;
    }
  }

  async getOnlineUsers(): Promise<string[]> {
    try {
      const redis = getRedisClient();
      return await redis.smembers(PresenceService.onlineUsersKey());
    } catch (err: any) {
      logger.error({ err: err.message }, 'Redis error fetching online users');
      return [];
    }
  }
}

export const presenceService = new PresenceService();
