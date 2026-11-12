import { createRedisClient } from '../../src/config/redis';

describe('Redis Configuration', () => {
  it('should enable TLS automatically for rediss:// URLs', () => {
    const client = createRedisClient('rediss://default:secret@localhost:6380', {
      lazyConnect: true
    });

    expect(client.options.tls).toBeDefined();
    client.disconnect();
  });

  it('should not enable TLS for standard redis:// URLs by default', () => {
    const client = createRedisClient('redis://localhost:6379', {
      lazyConnect: true
    });

    expect(client.options.tls).toBeUndefined();
    client.disconnect();
  });

  it('should have an error listener to prevent process crashing on errors', () => {
    const client = createRedisClient('redis://localhost:6379', {
      lazyConnect: true
    });

    const errorListeners = client.listeners('error');
    expect(errorListeners.length).toBeGreaterThan(0);

    // Emitting an error should not throw unhandled exception
    expect(() => {
      client.emit('error', new Error('Simulated Redis connection failure'));
    }).not.toThrow();

    client.disconnect();
  });
});
