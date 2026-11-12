import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { getEnv } from './config/env';
import { healthRouter } from './routes/health.routes';
import { keysRouter } from './routes/keys.routes';

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

  // Mount routes
  app.use(healthRouter);
  app.use(keysRouter);

  return app;
}
