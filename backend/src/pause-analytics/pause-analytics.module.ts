import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { PoliciesModule } from '../policies/policies.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { PauseAnalyticsController } from './pause-analytics.controller';
import { PauseAnalyticsService } from './pause-analytics.service';

@Module({
  imports: [AuthModule, PoliciesModule, AnalyticsModule],
  controllers: [PauseAnalyticsController],
  providers: [PauseAnalyticsService, PrismaService],
  exports: [PauseAnalyticsService],
})
export class PauseAnalyticsModule {}
