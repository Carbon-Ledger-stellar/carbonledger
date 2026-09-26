import { createHash } from 'crypto';

/**
 * Cache key generator utilities
 */
export class CacheKeyGenerator {
  /**
   * Generate a cache key for project listings
   * Includes all filters in the hash to differentiate between different filter combinations
   */
  static projectListingKey(filters: Record<string, any>): string {
    const hash = this.hashFilters(filters);
    return `project:listing:${hash}`;
  }

  /**
   * Generate a cache key for market prices
   */
  static marketPricesKey(vintage?: number, status?: string): string {
    const suffix = [vintage, status].filter(Boolean).join(':');
    return suffix ? `market:prices:${suffix}` : 'market:prices:all';
  }

  /**
   * Generate a cache key for a single project
   */
  static projectDetailKey(projectId: string): string {
    return `project:detail:${projectId}`;
  }

  /**
   * Generate a cache key for batch verification
   */
  static batchVerificationKey(batchId: string): string {
    return `batch:verification:${batchId}`;
  }

  /**
   * Hash filter object to create a deterministic cache key
   * Sorts keys to ensure consistent hashing for the same filters
   */
  private static hashFilters(filters: Record<string, any>): string {
    const sorted = Object.keys(filters)
      .sort()
      .map(key => {
        const value = filters[key];
        return `${key}=${JSON.stringify(value)}`;
      })
      .join('|');

    return createHash('sha256').update(sorted).digest('hex').substring(0, 16);
  }
}

/**
 * Cache TTL constants (in seconds)
 */
export const CACHE_TTL = {
  PROJECT_LISTING: 5 * 60,        // 5 minutes - project lists change frequently
  PROJECT_DETAIL: 10 * 60,        // 10 minutes - project details are relatively stable
  MARKET_PRICES: 5 * 60,          // 5 minutes - prices change with new listings
  BATCH_VERIFICATION: 30 * 60,    // 30 minutes - batch status changes less frequently
  USER_PORTFOLIO: 2 * 60,         // 2 minutes - user-specific data
} as const;

/**
 * Cache hit rate tracking
 */
export class CacheMetrics {
  private static hits = 0;
  private static misses = 0;

  static recordHit(): void {
    this.hits++;
  }

  static recordMiss(): void {
    this.misses++;
  }

  static getHitRate(): number {
    const total = this.hits + this.misses;
    if (total === 0) return 0;
    return (this.hits / total) * 100;
  }

  static getStats() {
    return {
      hits: this.hits,
      misses: this.misses,
      total: this.hits + this.misses,
      hitRate: this.getHitRate().toFixed(2) + '%',
    };
  }

  static reset(): void {
    this.hits = 0;
    this.misses = 0;
  }
}
