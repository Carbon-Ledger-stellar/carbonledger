import { Injectable, Logger, Optional } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { BucketState } from './quota.store';

/**
 * Redis-backed quota store using get/set for atomic-ish sliding fixed-window
 * counters. Falls back to in-memory when Redis is unavailable.
 *
 * Redis key format: rate_limit:{identity}:{endpoint}
 *
 * Note: The get→increment→set approach has a small race window under extreme
 * concurrency. For single-instance deployments this is acceptable; a Lua
 * script (INCR + EXPIRE) can be added if atomic guarantees are needed at scale.
 */
@Injectable()
export class RedisQuotaStore {
  private readonly logger = new Logger(RedisQuotaStore.name);
  private readonly fallback = new Map<string, BucketState>();

  constructor(
    @Optional() private readonly redisService?: RedisService,
  ) {}

  /**
   * Async increment using Redis. The RedisService key is prefixed with
   * `rate_limit:` here so callers only supply the logical `{identity}:{endpoint}`
   * portion.
   *
   * Returns the updated BucketState.
   */
  async incrementAsync(key: string, windowMs: number, now: number): Promise<BucketState> {
    if (!this.redisService) {
      return this.fallbackIncrement(key, windowMs, now);
    }

    try {
      const redisKey = `rate_limit:${key}`;
      const existing = await this.redisService.get<BucketState>(redisKey);
      const windowSec = Math.ceil(windowMs / 1000);

      // If window has expired or no entry exists, start a fresh window
      if (!existing || now >= existing.resetAt) {
        const state: BucketState = {
          count: 1,
          windowStart: now,
          resetAt: now + windowMs,
        };
        await this.redisService.set(redisKey, state, windowSec);
        return state;
      }

      // Increment within existing window
      existing.count += 1;
      const ttlRemaining = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      await this.redisService.set(redisKey, existing, ttlRemaining);
      return existing;
    } catch (err) {
      this.logger.warn(`Redis rate-limit failed, using in-memory fallback: ${err}`);
      return this.fallbackIncrement(key, windowMs, now);
    }
  }

  /**
   * Synchronous increment — uses in-memory fallback only.
   * Kept for backward compatibility with the synchronous RoleLimitGuard.
   */
  increment(key: string, windowMs: number, now: number): BucketState {
    return this.fallbackIncrement(key, windowMs, now);
  }

  /**
   * Returns remaining time (ms) until the window resets.
   * Only looks at the in-memory fallback map (used after sync increment or
   * when Redis is unavailable).
   */
  ttl(key: string, now: number): number {
    const state = this.fallback.get(key);
    if (!state) return 0;
    return Math.max(0, state.resetAt - now);
  }

  /** Evict expired entries from the in-memory fallback to prevent memory growth. */
  evictExpired(now: number): void {
    for (const [k, s] of this.fallback.entries()) {
      if (now >= s.resetAt) {
        this.fallback.delete(k);
      }
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private fallbackIncrement(key: string, windowMs: number, now: number): BucketState {
    const existing = this.fallback.get(key);
    if (!existing || now >= existing.resetAt) {
      const state: BucketState = {
        count: 1,
        windowStart: now,
        resetAt: now + windowMs,
      };
      this.fallback.set(key, state);
      return state;
    }
    existing.count += 1;
    this.fallback.set(key, existing);
    return existing;
  }
}
