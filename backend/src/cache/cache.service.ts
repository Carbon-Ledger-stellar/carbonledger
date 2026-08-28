/**
 * cache.service.ts
 *
 * CacheInvalidationService — centralised cache invalidation hooks for the
 * CarbonLedger API layer.
 *
 * Design goals
 * ────────────
 * • All state-changing operations that affect cached data call into this
 *   service rather than calling RedisService or ListingsCacheService directly.
 * • Falls back silently to database reads when Redis is offline — a failed
 *   invalidation never blocks the primary write path.
 * • Every method is idempotent: calling it twice has the same effect as
 *   calling it once.
 *
 * Cache key namespaces managed here
 * ──────────────────────────────────
 * • project-detail:<projectId>   — single project detail responses
 * • project-detail:*             — all project detail cache entries
 * • listings:*                   — all marketplace listings cache entries
 *
 * Closes #925
 */

import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis.service';
import { ListingsCacheService } from '../marketplace/listings-cache.service';
import {
  projectDetailCacheKey,
  PROJECT_DETAIL_CACHE_KEY_PREFIX,
} from './cache.constants';

@Injectable()
export class CacheInvalidationService {
  private readonly logger = new Logger(CacheInvalidationService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly listingsCache: ListingsCacheService,
  ) {}

  // ── Project cache invalidation hooks ──────────────────────────────────────

  /**
   * Invalidate the cached detail record for a single project.
   *
   * Called when:
   *   - A project is created   (POST /projects)
   *   - A project status is updated (PATCH /projects/:id/status)
   *   - A project is verified  (POST /projects/:id/verify)
   *   - A project is rejected  (POST /projects/:id/reject)
   */
  async invalidateProjectDetail(projectId: string): Promise<void> {
    try {
      const key = projectDetailCacheKey(projectId);
      await this.redis.del(key);
      this.logger.debug(`Cache invalidated for project: ${projectId}`);
    } catch (err) {
      // Non-fatal — log and continue; database will serve fresh data
      this.logger.warn(
        `Failed to invalidate project cache for ${projectId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Invalidate all cached project detail entries.
   *
   * Called when bulk or cross-project state changes occur (e.g. oracle
   * suspension sweeps, admin bulk-status updates).
   */
  async invalidateAllProjectDetails(): Promise<void> {
    try {
      await this.redis.delByPattern(`${PROJECT_DETAIL_CACHE_KEY_PREFIX}*`);
      this.logger.debug('All project detail cache entries invalidated');
    } catch (err) {
      this.logger.warn(
        `Failed to invalidate all project caches: ${(err as Error).message}`,
      );
    }
  }

  // ── Marketplace listings cache invalidation hooks ─────────────────────────

  /**
   * Invalidate all marketplace listing cache entries.
   *
   * Called when:
   *   - A listing is created   (POST /marketplace/listings)
   *   - A listing is delisted  (DELETE /marketplace/listings/:id)
   *   - A purchase is executed (POST /marketplace/purchase)
   *   - A credit batch is retired, reducing available supply
   */
  async invalidateAllListings(): Promise<void> {
    try {
      await this.listingsCache.invalidateAll();
      this.logger.debug('All listings cache entries invalidated');
    } catch (err) {
      this.logger.warn(
        `Failed to invalidate listings cache: ${(err as Error).message}`,
      );
    }
  }

  // ── Compound invalidation helpers ─────────────────────────────────────────

  /**
   * Invalidate both the project detail cache and the listings cache for a
   * project whose status has changed (e.g. verification, suspension, rejection).
   *
   * A project status change can make current listings invalid (suspended project
   * credits are no longer tradable) so both namespaces must be flushed.
   */
  async invalidateProjectAndListings(projectId: string): Promise<void> {
    await Promise.all([
      this.invalidateProjectDetail(projectId),
      this.invalidateAllListings(),
    ]);
  }

  /**
   * Invalidate caches that are affected when new credits are minted.
   *
   * Minting credits changes a project's totalCreditsIssued counter (cached
   * in the project detail) and may affect marketplace availability stats.
   */
  async invalidateOnCreditMint(projectId: string): Promise<void> {
    await Promise.all([
      this.invalidateProjectDetail(projectId),
      this.invalidateAllListings(),
    ]);
  }

  /**
   * Invalidate caches that are affected when credits are retired.
   *
   * Retirement changes:
   *   - The project's totalCreditsRetired counter (project detail cache)
   *   - Available supply in marketplace listings
   */
  async invalidateOnCreditRetire(projectId: string): Promise<void> {
    await Promise.all([
      this.invalidateProjectDetail(projectId),
      this.invalidateAllListings(),
    ]);
  }
}
