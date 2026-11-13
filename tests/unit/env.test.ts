import { validateEnv } from '../../src/config/env';

describe('Environment validation', () => {
  it('should validate valid environment configuration', () => {
    const validConfig = {
      NODE_ENV: 'test',
      PORT: '4000',
      JWT_ACCESS_SECRET: 'test-secret-12345',
      MONGODB_URI: 'mongodb://localhost:27017/test',
      REDIS_URL: 'redis://localhost:6379',
      CORS_ORIGIN: 'http://localhost:3000'
    };

    const parsed = validateEnv(validConfig);
    expect(parsed.PORT).toBe(4000);
    expect(parsed.JWT_ACCESS_SECRET).toBe('test-secret-12345');
    expect(parsed.MESSAGE_RATE_LIMIT_MAX).toBe(30);
  });

  it('should throw an error when required variables are missing', () => {
    const invalidConfig = {
      PORT: '4000'
      // missing JWT_ACCESS_SECRET, MONGODB_URI, REDIS_URL
    };

    expect(() => validateEnv(invalidConfig as any)).toThrow('Environment validation failed');
  });

  it('should reject invalid NODE_ENV', () => {
    const invalidConfig = {
      NODE_ENV: 'invalid_env',
      JWT_ACCESS_SECRET: 'test-secret',
      MONGODB_URI: 'mongodb://localhost:27017/test',
      REDIS_URL: 'redis://localhost:6379'
    };

    expect(() => validateEnv(invalidConfig as any)).toThrow();
  });
});
