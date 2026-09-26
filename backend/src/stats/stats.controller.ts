import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { StatsService } from './stats.service';
import { Public } from '../auth/decorators';
import { getCacheMetrics as getListingsCacheMetrics } from '../marketplace/listings-cache.service';
import { getAllCacheMetrics, getOverallCacheMetrics } from '../cache/api-cache.service';

@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 100 } })
  getStats() {
    return this.statsService.getPlatformStats();
  }

  @Get("aggregate")
  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 100 } })
  getAggregateStats() {
    return this.statsService.getAggregateStats();
  }

  /**
   * GET /stats/cache
   *
   * Returns cache hit/miss metrics per endpoint plus overall summary.
   * Includes both the API response cache (Redis-backed) and the listings
   * in-process cache for completeness.
   */
  @Get("cache")
  getCacheStats() {
    return {
      overall:   getOverallCacheMetrics(),
      endpoints: getAllCacheMetrics(),
      listings:  getListingsCacheMetrics(),
    };
  }

  @Get("leaderboard")
  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 100 } })
  getLeaderboard(@Query("year") year?: string) {
    const y = year ? parseInt(year, 10) : undefined;
    return this.statsService.getLeaderboard(Number.isFinite(y) ? y : undefined);
  }
}
