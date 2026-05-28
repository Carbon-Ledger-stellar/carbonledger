import { Controller, Get } from '@nestjs/common';
import { StatsService } from './stats.service';
import { Public } from '../auth/decorators';

@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  @Public()
  getStats() {
    return this.statsService.getPlatformStats();
  }

  @Get("cache")
  getCacheStats() {
    return { listings: getCacheMetrics() };
  }
}
