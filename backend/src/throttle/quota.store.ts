import { Injectable } from '@nestjs/common';

export interface BucketState {
  count: number;
  windowStart: number; // epoch ms
  resetAt: number;     // epoch ms
}

/**
 * In-memory quota store backed by a plain Map.
 *
 * Key format: `<identity>:<bucket>` where identity is either a JWT subject
 * (authenticated) or IP address (unauthenticated public).
 *
 * A real production deployment should replace this with a Redis store so
 * quota state is shared across multiple backend instances.
 */
@Injectable()
export class QuotaStore {
  private readonly store = new Map<string, BucketState>();

  /**
   * Returns the current bucket state, initialising a fresh window if:
   * - the key has never been seen, or
   * - the current window has expired.
   */
  getOrInit(key: string, windowMs: number, now: number): BucketState {
    const existing = this.store.get(key);
    if (!existing || now >= existing.resetAt) {
      const state: BucketState = {
        count: 0,
        windowStart: now,
        resetAt: now + windowMs,
      };
      this.store.set(key, state);
      return state;
    }
    return existing;
  }

  /** Increment the counter for a key, returning the updated state. */
  increment(key: string, windowMs: number, now: number): BucketState {
    const state = this.getOrInit(key, windowMs, now);
    state.count += 1;
    this.store.set(key, state);
    return state;
  }

  /** Returns remaining time (ms) until the window resets. */
  ttl(key: string, now: number): number {
    const state = this.store.get(key);
    if (!state) return 0;
    return Math.max(0, state.resetAt - now);
  }

  /** Evict expired entries to prevent unbounded memory growth. */
  evictExpired(now: number): void {
    for (const [key, state] of this.store.entries()) {
      if (now >= state.resetAt) {
        this.store.delete(key);
      }
    }
  }
}
