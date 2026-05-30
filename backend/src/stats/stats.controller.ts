import { Controller, Get } from '@nestjs/common';
import { StatsService } from './stats.service';
import { Public } from '../auth/decorators';
import { getCacheMetrics } from '../marketplace/listings-cache.service';

@Controller('stats')
export class StatsController {
  private cachedAggregateStats: any = null;
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL = 60 * 1000; // 60 seconds

  constructor(private readonly statsService: StatsService) {}

  @Get()
  @Public()
  getStats() {
    return this.statsService.getPlatformStats();
  }

  @Get("aggregate")
  @Public()
  async getAggregateStats() {
    const now = Date.now();
    
    // Return cached data if still valid
    if (this.cachedAggregateStats && now < this.cacheExpiry) {
      return this.cachedAggregateStats;
    }

    // Fetch fresh data
    const stats = await this.statsService.getAggregateStats();
    
    // Cache the result
    this.cachedAggregateStats = stats;
    this.cacheExpiry = now + this.CACHE_TTL;

    return stats;
  }

  @Get("cache")
  getCacheStats() {
    return { listings: getCacheMetrics() };
  }
}
