process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-jwt-secret-shared-with-auth-service-256bit';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/securechat-test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
process.env.LOG_LEVEL = 'silent';
