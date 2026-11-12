import mongoose from 'mongoose';
import { logger } from './logger';
import { getEnv } from './env';

export async function connectDb(customUri?: string): Promise<typeof mongoose> {
  const env = getEnv();
  const uri = customUri || env.MONGODB_URI;

  try {
    const conn = await mongoose.connect(uri);
    logger.info({ host: conn.connection.host }, 'MongoDB connected');
    return conn;
  } catch (err: any) {
    logger.error({ err: err.message }, 'MongoDB connection error');
    throw err;
  }
}

export async function disconnectDb(): Promise<void> {
  try {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected');
  } catch (err: any) {
    logger.error({ err: err.message }, 'MongoDB disconnection error');
  }
}
