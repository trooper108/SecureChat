import { validateEnv, getEnv } from './config/env';
import { logger } from './config/logger';
import { connectDb, disconnectDb } from './config/db';
import { getRedisClient, closeRedis } from './config/redis';
import { createServer } from './server';

async function bootstrap() {
  try {
    // Validate environment variables on startup
    validateEnv();
    const env = getEnv();

    // Initialize databases
    await connectDb();
    getRedisClient(); // triggers connection listener

    // Create server instance
    const { httpServer } = createServer();

    const server = httpServer.listen(env.PORT, () => {
      logger.info(`SecureChat backend is running on port ${env.PORT} in ${env.NODE_ENV} mode`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);
      server.close(async () => {
        logger.info('HTTP server closed');
        await closeRedis();
        await disconnectDb();
        logger.info('Graceful shutdown complete');
        process.exit(0);
      });

      // Force shutdown after 10 seconds if graceful shutdown hangs
      setTimeout(() => {
        logger.error('Forced shutdown due to timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err: any) {
    logger.error({ err: err.message }, 'Application failed to start');
    process.exit(1);
  }
}

bootstrap();
