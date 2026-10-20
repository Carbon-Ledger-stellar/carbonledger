import Redis from 'ioredis';
import { config } from '../config';
import { metricsService } from '../metrics/metrics.service';

const PROJECT_LISTINGS_CACHE_PREFIX = 'project:listings:';
const PROJECT_LISTINGS_CACHE_TTL_SECONDS = config.projectListingsCacheTtlSeconds ?? 60;

let client: Redis | null = null;

export function getRedisClient(): Redis {
  if (!client) {
    client = new Redis(config.redisUrl, {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
  }
  return client;
}

export function projectListingsCacheKey(key: string): string {
  return `${PROJECT_LISTINGS_CACHE_PREFIX}${key}`;
}

/**
 * Read a cached project listing. Records a hit/miss on the listings cache
 * so the hit ratio metric stays accurate.
 */
export async function getCachedProjectListings<T>(key: string): Promise<T | null> {
  const cacheKey = projectListingsCacheKey(key);
  try {
    const raw = await getRedisClient().get(cacheKey);
    if (raw === null) {
      metricsService.recordProjectListingsCacheMiss();
      return null;
    }
    metricsService.recordProjectListingsCacheHit();
    return JSON.parse(raw) as T;
  } catch (err) {
    metricsService.recordProjectListingsCacheMiss();
    return null;
  }
}

/**
 * Store a project listing with the configured TTL.
 */
export async function setCachedProjectListings<T>(key: string, value: T): Promise<void> {
  const cacheKey = projectListingsCacheKey(key);
  try {
    await getRedisClient().set(
      cacheKey,
      JSON.stringify(value),
      'EX',
      PROJECT_LISTINGS_CACHE_TTL_SECONDS,
    );
  } catch (err) {
    // Cache writes are best-effort; never fail the request path.
  }
}

/**
 * Invalidate all cached project listings. Called when project update events
 * are emitted/handled so stale listings are not served.
 */
export async function invalidateProjectListingsCache(): Promise<void> {
  try {
    const redis = getRedisClient();
    const stream = redis.scanStream({ match: `${PROJECT_LISTINGS_CACHE_PREFIX}*`, count: 100 });
    const keysToDelete: string[] = [];
    for await (const keys of stream) {
      keysToDelete.push(...(keys as string[]));
    }
    if (keysToDelete.length > 0) {
      await redis.del(...keysToDelete);
    }
  } catch (err) {
    // Invalidation is best-effort; TTL bounds staleness if Redis is unavailable.
  }
}
