import { Module, Global } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

/**
 * AnalyticsModule is marked @Global so any feature module can inject
 * AnalyticsService without importing AnalyticsModule explicitly.
 */
@Global()
@Module({
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
