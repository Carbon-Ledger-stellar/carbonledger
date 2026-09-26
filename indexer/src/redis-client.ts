/**
 * Shared Redis client singleton for the indexer.
 * Uses ioredis with lazy connect to avoid crashing on startup if Redis is unavailable.
 */

import Redis from 'ioredis';

let client: Redis | null = null;

export function getRedisClient(): Redis {
  if (!client) {
    client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: false,
      enableOfflineQueue: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 2000),
    });

    client.on('error', (err) => {
      // Log but do not crash — rate limiting fails open
      console.error('[redis] Connection error:', err.message);
    });
  }
  return client;
}

/** For testing: replace the client with a mock/stub. */
export function setRedisClient(mock: Redis): void {
  client = mock;
}

/** Gracefully close the Redis connection. */
export async function closeRedisClient(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
