import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';

/** Simple hit/miss counters — reset on process restart, sufficient for metrics. */
const metrics = { hits: 0, misses: 0 };

export function getCacheMetrics() {
  const total = metrics.hits + metrics.misses;
  return {
    hits:     metrics.hits,
    misses:   metrics.misses,
    hitRate:  total ? +(metrics.hits / total).toFixed(4) : 0,
  };
}

@Injectable()
export class ListingsCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(ListingsCacheService.name);
  private readonly redis: Redis;
  private readonly TTL = 60; // seconds

  constructor() {
    this.redis = new Redis({
      host:     process.env.REDIS_HOST     || 'localhost',
      port:     parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
      lazyConnect: true,
    });
    this.redis.connect().catch(err =>
      this.logger.warn(`Redis unavailable, caching disabled: ${err.message}`),
    );
  }

  private key(suffix: string) {
    return `listings:${suffix}`;
  }

  async get<T>(cacheKey: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(this.key(cacheKey));
      if (raw) { metrics.hits++;  return JSON.parse(raw) as T; }
      metrics.misses++;
      return null;
    } catch {
      metrics.misses++;
      return null;
    }
  }

  async set(cacheKey: string, value: unknown): Promise<void> {
    try {
      await this.redis.set(this.key(cacheKey), JSON.stringify(value), 'EX', this.TTL);
    } catch { /* cache write failure is non-fatal */ }
  }

  async invalidateAll(): Promise<void> {
    try {
      const keys = await this.redis.keys(this.key('*'));
      if (keys.length) await this.redis.del(...keys);
    } catch { /* non-fatal */ }
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
