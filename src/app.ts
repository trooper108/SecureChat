import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { getEnv } from './config/env';
import { healthRouter } from './routes/health.routes';

export function createApp(): Application {
  const env = getEnv();
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN.split(','),
      credentials: true
    })
  );
  app.use(express.json({ limit: '1mb' }));

  // Mount health check route
  app.use(healthRouter);

  return app;
}
