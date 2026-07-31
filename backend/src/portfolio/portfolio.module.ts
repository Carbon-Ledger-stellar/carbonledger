import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';
import { PrismaService } from '../prisma.service';
import { PortfolioRefreshScheduler } from './portfolio-refresh.scheduler';

/**
 * PortfolioModule
 *
 * Provides the portfolio-level carbon metrics aggregation API.
 *
 * Dependencies (all @Global):
 *   - RedisService  (exported by RedisModule, registered globally in AppModule)
 *
 * Exports PortfolioService so that RetirementsService and CreditsService can
 * call invalidateCache(address) after any mutation that changes portfolio totals.
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [PortfolioController],
  providers: [PortfolioService, PrismaService, PortfolioRefreshScheduler],
  exports: [PortfolioService],
})
export class PortfolioModule {}
