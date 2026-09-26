/**
 * Cache Invalidation Service
 * 
 * Handles automatic cache invalidation for Prisma middleware when
 * data mutations occur. Ensures no stale data is served.
 */

import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis.service';

@Injectable()
export class CacheInvalidationService {
  private readonly logger = new Logger('CacheInvalidationService');
  private readonly keyPrefix = 'prisma:cache:';

  constructor(private readonly redis: RedisService) {}

  /**
   * Invalidate all cache entries matching a pattern
   */
  async invalidatePattern(pattern: string): Promise<number> {
    try {
      const keys = await this.redis.keys(`${this.keyPrefix}${pattern}*`);
      if (keys.length === 0) return 0;

      const deletedCount = await this.redis.del(...keys);
      this.logger.debug(`Invalidated ${deletedCount} cache entries for pattern: ${pattern}`);
      return deletedCount;
    } catch (error) {
      this.logger.error(`Error invalidating pattern ${pattern}:`, error);
      return 0;
    }
  }

  /**
   * Invalidate specific project and related caches
   */
  async invalidateProject(projectId: string): Promise<void> {
    await Promise.all([
      this.invalidatePattern(`CarbonProject:*${projectId}*`),
      this.invalidatePattern(`CreditBatch:*${projectId}*`),
      this.invalidatePattern(`MarketListing:*${projectId}*`),
      this.invalidatePattern(`RetirementRecord:*${projectId}*`),
    ]);
    this.logger.debug(`Invalidated all caches for project: ${projectId}`);
  }

  /**
   * Invalidate all project caches (global refresh)
   */
  async invalidateAllProjects(): Promise<void> {
    await Promise.all([
      this.invalidatePattern('CarbonProject:'),
      this.invalidatePattern('CreditBatch:'),
      this.invalidatePattern('MarketListing:'),
    ]);
    this.logger.debug('Invalidated all project-related caches');
  }

  /**
   * Invalidate specific credit batch and related caches
   */
  async invalidateBatch(batchId: string): Promise<void> {
    await Promise.all([
      this.invalidatePattern(`CreditBatch:*${batchId}*`),
      this.invalidatePattern(`RetirementRecord:*${batchId}*`),
      this.invalidatePattern('MarketListing:'),
    ]);
    this.logger.debug(`Invalidated all caches for batch: ${batchId}`);
  }

  /**
   * Invalidate all listing caches
   */
  async invalidateAllListings(): Promise<void> {
    await this.invalidatePattern('MarketListing:');
    this.logger.debug('Invalidated all marketplace listings');
  }

  /**
   * Invalidate price and pricing-related caches
   */
  async invalidatePricing(): Promise<void> {
    await Promise.all([
      this.invalidatePattern('PriceApproval:'),
      this.invalidatePattern('PriceHistory:'),
    ]);
    this.logger.debug('Invalidated all pricing caches');
  }

  /**
   * Invalidate user-related caches
   */
  async invalidateUser(publicKey: string): Promise<void> {
    await Promise.all([
      this.invalidatePattern(`User:*${publicKey}*`),
      this.invalidatePattern(`RetirementRecord:*${publicKey}*`),
    ]);
    this.logger.debug(`Invalidated all caches for user: ${publicKey}`);
  }

  /**
   * Invalidate retirement caches
   */
  async invalidateRetirement(retirementId: string): Promise<void> {
    await this.invalidatePattern(`RetirementRecord:*${retirementId}*`);
    this.logger.debug(`Invalidated cache for retirement: ${retirementId}`);
  }

  /**
   * Compound invalidation for project status change
   * (affects projects, batches, and listings)
   */
  async invalidateProjectStatusChange(projectId: string): Promise<void> {
    await this.invalidateProject(projectId);
    this.logger.debug(`Invalidated caches for project status change: ${projectId}`);
  }

  /**
   * Compound invalidation for credit transaction
   * (affects batch and retirement caches)
   */
  async invalidateCreditsTransaction(
    batchId: string,
    projectId: string,
  ): Promise<void> {
    await Promise.all([
      this.invalidateBatch(batchId),
      this.invalidateProject(projectId),
    ]);
    this.logger.debug(
      `Invalidated caches for credits transaction: batch=${batchId}, project=${projectId}`,
    );
  }

  /**
   * Compound invalidation for marketplace transaction
   */
  async invalidateMarketplaceTransaction(
    projectId: string,
    batchId: string,
  ): Promise<void> {
    await Promise.all([
      this.invalidateBatch(batchId),
      this.invalidateProject(projectId),
      this.invalidateAllListings(),
    ]);
    this.logger.debug(
      `Invalidated caches for marketplace transaction: project=${projectId}`,
    );
  }

  /**
   * Get cache statistics (hit/miss ratios)
   */
  async getCacheStats(): Promise<CacheStats> {
    try {
      const hitCountKey = `${this.keyPrefix}stats:hits`;
      const missCountKey = `${this.keyPrefix}stats:misses`;

      const hits = parseInt(await this.redis.get(hitCountKey), 10) || 0;
      const misses = parseInt(await this.redis.get(missCountKey), 10) || 0;
      const total = hits + misses;
      const hitRate = total > 0 ? ((hits / total) * 100).toFixed(2) : '0.00';

      return {
        hits,
        misses,
        total,
        hitRate: parseFloat(hitRate),
      };
    } catch (error) {
      this.logger.error('Error retrieving cache stats:', error);
      return {
        hits: 0,
        misses: 0,
        total: 0,
        hitRate: 0,
      };
    }
  }

  /**
   * Reset cache statistics
   */
  async resetCacheStats(): Promise<void> {
    await Promise.all([
      this.redis.del(`${this.keyPrefix}stats:hits`),
      this.redis.del(`${this.keyPrefix}stats:misses`),
    ]);
    this.logger.debug('Cache statistics reset');
  }

  /**
   * Clear entire cache (dangerous - use with caution)
   */
  async clearAllCache(): Promise<number> {
    try {
      const keys = await this.redis.keys(`${this.keyPrefix}*`);
      if (keys.length === 0) return 0;

      const deletedCount = await this.redis.del(...keys);
      this.logger.warn(`Cleared entire cache: ${deletedCount} entries deleted`);
      return deletedCount;
    } catch (error) {
      this.logger.error('Error clearing all cache:', error);
      return 0;
    }
  }
}

export interface CacheStats {
  hits: number;
  misses: number;
  total: number;
  hitRate: number;
}

