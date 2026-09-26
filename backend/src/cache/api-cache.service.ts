/**
 * api-cache.service.ts
 *
 * ApiCacheService — centralised Redis-backed caching for API endpoint responses.
 *
 * Design goals
 * ────────────
 * • Wraps RedisService with a generic cache-aside pattern: get → miss → fetch → set.
 * • All caching is non-blocking: if Redis is unavailable the primary data source
 *   is used transparently.
 * • Exposes per-endpoint hit/miss counters for monitoring (GET /stats/cache).
 * • Uses the "cache:" key prefix to comply with RedisService key validation.
 *
 * Closes #1070
 */

import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis.service';

export interface CacheMetrics {
  hits: number;
  misses: number;
  errors: number;
  hitRate: number;
}

/** Per-endpoint hit/miss counters.  Resets on process restart. */
const counters: Record<string, { hits: number; misses: number; errors: number }> = {};

function record(endpoint: string, kind: 'hit' | 'miss' | 'error') {
  if (!counters[endpoint]) {
    counters[endpoint] = { hits: 0, misses: 0, errors: 0 };
  }
  counters[endpoint][kind === 'hit' ? 'hits' : kind === 'miss' ? 'misses' : 'errors']++;
}

export function getAllCacheMetrics(): Record<string, CacheMetrics> {
  const result: Record<string, CacheMetrics> = {};
  for (const [endpoint, c] of Object.entries(counters)) {
    const total = c.hits + c.misses;
    result[endpoint] = {
      hits: c.hits,
      misses: c.misses,
      errors: c.errors,
      hitRate: total ? +(c.hits / total).toFixed(4) : 0,
    };
  }
  return result;
}

export function getOverallCacheMetrics(): CacheMetrics {
  let hits = 0, misses = 0, errors = 0;
  for (const c of Object.values(counters)) {
    hits += c.hits;
    misses += c.misses;
    errors += c.errors;
  }
  const total = hits + misses;
  return { hits, misses, errors, hitRate: total ? +(hits / total).toFixed(4) : 0 };
}

@Injectable()
export class ApiCacheService {
  private readonly logger = new Logger(ApiCacheService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Cache-aside helper.
   *
   * @param key        Full Redis key (must start with an allowed prefix).
   * @param ttl        Time-to-live in seconds.
   * @param endpoint   Logical name used for per-endpoint metrics.
   * @param fetcher    Async function that returns fresh data on cache miss.
   * @returns          Cached or fresh data.
   */
  async getOrSet<T>(
    key: string,
    ttl: number,
    endpoint: string,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    // Attempt cache read
    try {
      const cached = await this.redis.get<T>(key);
      if (cached !== null) {
        record(endpoint, 'hit');
        return cached;
      }
      record(endpoint, 'miss');
    } catch (err) {
      record(endpoint, 'error');
      this.logger.warn(`Cache read error for "${key}": ${(err as Error).message}`);
      // Fall through to fetcher
    }

    // Cache miss — fetch fresh data
    const fresh = await fetcher();

    // Persist to cache (non-blocking, fire-and-forget)
    this.redis
      .set(key, fresh, ttl)
      .catch((err) =>
        this.logger.warn(`Cache write error for "${key}": ${(err as Error).message}`),
      );

    return fresh;
  }

  /**
   * Invalidate a single key.  Non-blocking.
   */
  async invalidate(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (err) {
      this.logger.warn(`Cache invalidation error for "${key}": ${(err as Error).message}`);
    }
  }

  /**
   * Invalidate all keys matching a glob pattern.  Non-blocking.
   * Pattern must start with an allowed Redis key prefix.
   */
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      await this.redis.delByPattern(pattern);
    } catch (err) {
      this.logger.warn(`Cache invalidation error for pattern "${pattern}": ${(err as Error).message}`);
    }
  }
}
