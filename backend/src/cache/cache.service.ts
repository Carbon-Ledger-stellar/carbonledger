import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis.service';
import { CacheKeyGenerator, CACHE_TTL, CacheMetrics } from './cache.decorator';

/**
 * CacheService provides higher-level caching operations for specific domains
 * It uses RedisService internally and handles cache invalidation patterns
 */
@Injectable()
export class CacheService {
  constructor(private readonly redis: RedisService) {}

  /**
   * Get cached project listing or null if not cached
   */
  async getProjectListing(filters: Record<string, any>) {
    const key = CacheKeyGenerator.projectListingKey(filters);
    const cached = await this.redis.get(key);

    if (cached) {
      CacheMetrics.recordHit();
    } else {
      CacheMetrics.recordMiss();
    }

    return cached;
  }

  /**
   * Cache project listing result
   */
  async setProjectListing(filters: Record<string, any>, data: any): Promise<boolean> {
    const key = CacheKeyGenerator.projectListingKey(filters);
    return this.redis.set(key, data, CACHE_TTL.PROJECT_LISTING);
  }

  /**
   * Get cached project details
   */
  async getProjectDetail(projectId: string) {
    const key = CacheKeyGenerator.projectDetailKey(projectId);
    const cached = await this.redis.get(key);

    if (cached) {
      CacheMetrics.recordHit();
    } else {
      CacheMetrics.recordMiss();
    }

    return cached;
  }

  /**
   * Cache project details
   */
  async setProjectDetail(projectId: string, data: any): Promise<boolean> {
    const key = CacheKeyGenerator.projectDetailKey(projectId);
    return this.redis.set(key, data, CACHE_TTL.PROJECT_DETAIL);
  }

  /**
   * Get cached market prices
   */
  async getMarketPrices(vintage?: number, status?: string) {
    const key = CacheKeyGenerator.marketPricesKey(vintage, status);
    const cached = await this.redis.get(key);

    if (cached) {
      CacheMetrics.recordHit();
    } else {
      CacheMetrics.recordMiss();
    }

    return cached;
  }

  /**
   * Cache market prices
   */
  async setMarketPrices(data: any, vintage?: number, status?: string): Promise<boolean> {
    const key = CacheKeyGenerator.marketPricesKey(vintage, status);
    return this.redis.set(key, data, CACHE_TTL.MARKET_PRICES);
  }

  /**
   * Get cached batch verification
   */
  async getBatchVerification(batchId: string) {
    const key = CacheKeyGenerator.batchVerificationKey(batchId);
    const cached = await this.redis.get(key);

    if (cached) {
      CacheMetrics.recordHit();
    } else {
      CacheMetrics.recordMiss();
    }

    return cached;
  }

  /**
   * Cache batch verification
   */
  async setBatchVerification(batchId: string, data: any): Promise<boolean> {
    const key = CacheKeyGenerator.batchVerificationKey(batchId);
    return this.redis.set(key, data, CACHE_TTL.BATCH_VERIFICATION);
  }

  /**
   * Invalidate all project-related caches
   * Called when a project is created, updated, or deleted
   */
  async invalidateProjectCaches(projectId?: string): Promise<boolean> {
    const patterns = [
      'project:listing:*',      // Invalidate all project listings
      'market:prices:*',         // Market prices may have changed
      projectId ? `project:detail:${projectId}` : 'project:detail:*',
    ];

    let success = true;
    for (const pattern of patterns) {
      const result = await this.redis.delByPattern(pattern);
      success = success && result;
    }

    return success;
  }

  /**
   * Invalidate market-related caches
   * Called when market listings are created, updated, or deleted
   */
  async invalidateMarketCaches(): Promise<boolean> {
    const patterns = [
      'market:prices:*',
      'project:listing:*',  // Listing counts may have changed
    ];

    let success = true;
    for (const pattern of patterns) {
      const result = await this.redis.delByPattern(pattern);
      success = success && result;
    }

    return success;
  }

  /**
   * Invalidate batch-related caches
   * Called when batch status changes
   */
  async invalidateBatchCaches(batchId: string, projectId: string): Promise<boolean> {
    const patterns = [
      `batch:verification:${batchId}`,
      'project:listing:*',  // Batch counts may have changed
      `project:detail:${projectId}`,
    ];

    let success = true;
    for (const pattern of patterns) {
      const result = await this.redis.delByPattern(pattern);
      success = success && result;
    }

    return success;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      redis: {
        connected: this.redis.isConnected,
      },
      metrics: CacheMetrics.getStats(),
    };
  }

  /**
   * Clear all caches (use with caution, typically for testing only)
   */
  async clearAll(): Promise<boolean> {
    return this.redis.delByPattern('*');
  }

  /**
   * Invalidate a single marketplace listing detail cache entry.
   * Called after a purchase partially fills or fully sells a listing.
   */
  async invalidateListingDetail(listingId: string): Promise<void> {
    try {
      await this.redis.del(marketplaceListingDetailCacheKey(listingId));
      this.logger.debug(`Listing detail cache invalidated for: ${listingId}`);
    } catch (err) {
      this.logger.warn(
        `Failed to invalidate listing detail cache for ${listingId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Invalidate all stats caches (platform stats, aggregate stats, leaderboard).
   * Called on credit mint, retire, and purchase events.
   */
  async invalidateStats(): Promise<void> {
    try {
      await Promise.all([
        this.redis.del(STATS_CACHE_KEY),
        this.redis.del(STATS_AGGREGATE_CACHE_KEY),
        this.redis.delByPattern(`${STATS_LEADERBOARD_CACHE_KEY_PREFIX}*`),
      ]);
      this.logger.debug('Stats caches invalidated');
    } catch (err) {
      this.logger.warn(
        `Failed to invalidate stats caches: ${(err as Error).message}`,
      );
    }
  }
}
