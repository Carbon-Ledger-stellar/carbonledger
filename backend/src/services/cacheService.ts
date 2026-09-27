import Redis from 'ioredis';

/**
 * Cache key for the contract pause status.
 */
export const PAUSE_STATUS_CACHE_KEY = 'contract:pause:status';

/**
 * TTL (in seconds) for the cached pause status.
 */
export const PAUSE_STATUS_CACHE_TTL_SECONDS = 30;

/**
 * Minimal Redis client surface used by the cache service.
 * Kept narrow so it can be mocked easily in tests.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<'OK' | null>;
  del(key: string): Promise<number>;
}

let client: RedisLike | null = null;

/**
 * Lazily create (and memoize) the Redis client.
 * Returns null when no connection string is configured so callers can
 * gracefully fall back to the database.
 */
export function getRedisClient(): RedisLike | null {
  if (client) {
    return client;
  }

  const url = process.env.REDIS_URL;
  if (!url) {
    return null;
  }

  client = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
  }) as unknown as RedisLike;

  return client;
}

/**
 * Read the cached pause status.
 * Returns null on cache miss or when Redis is unavailable.
 */
export async function getCachedPauseStatus(): Promise<boolean | null> {
  const redis = getRedisClient();
  if (!redis) {
    return null;
  }

  try {
    const cached = await redis.get(PAUSE_STATUS_CACHE_KEY);
    if (cached === null) {
      return null;
    }
    return cached === 'true';
  } catch {
    return null;
  }
}

/**
 * Store the pause status in Redis with the configured TTL.
 */
export async function setCachedPauseStatus(paused: boolean): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  try {
    await redis.set(
      PAUSE_STATUS_CACHE_KEY,
      paused ? 'true' : 'false',
      'EX',
      PAUSE_STATUS_CACHE_TTL_SECONDS,
    );
  } catch {
    // Cache writes are best-effort; never fail the caller.
  }
}

/**
 * Invalidate the cached pause status.
 * Called on pause/unpause so the next read falls back to the database.
 */
export async function invalidatePauseStatusCache(): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  try {
    await redis.del(PAUSE_STATUS_CACHE_KEY);
  } catch {
    // Invalidation is best-effort; the TTL bounds staleness.
  }
}

/**
 * Resolve the pause status using a cache-aside strategy:
 * 1. Try Redis (30s TTL).
 * 2. On miss, fall back to the database loader.
 * 3. Populate the cache for subsequent reads.
 */
export async function getPauseStatus(
  loadFromDb: () => Promise<boolean>,
): Promise<boolean> {
  const cached = await getCachedPauseStatus();
  if (cached !== null) {
    return cached;
  }

  const paused = await loadFromDb();
  await setCachedPauseStatus(paused);
  return paused;
}
