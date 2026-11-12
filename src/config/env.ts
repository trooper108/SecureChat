import { z } from 'zod';
import dotenv from 'dotenv';

// Safely attempt to load local .env without throwing if missing
dotenv.config({ quiet: true });

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  JWT_ACCESS_SECRET: z.string().min(1, 'JWT_ACCESS_SECRET is required'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  CORS_ORIGIN: z.string().default('*'),
  MESSAGE_RATE_LIMIT_WINDOW_SECS: z.coerce.number().int().positive().default(60),
  MESSAGE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  LOG_LEVEL: z.string().default('info')
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function validateEnv(customEnv?: Record<string, string | undefined>): Env {
  const source = customEnv ?? process.env;
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const formatted = result.error.errors
      .map((e) => `[${e.path.join('.')}]: ${e.message}`)
      .join('; ');
    throw new Error(`Environment validation failed: ${formatted}`);
  }

  cachedEnv = result.data;
  return result.data;
}

export function getEnv(): Env {
  if (!cachedEnv) {
    return validateEnv();
  }
  return cachedEnv;
}
