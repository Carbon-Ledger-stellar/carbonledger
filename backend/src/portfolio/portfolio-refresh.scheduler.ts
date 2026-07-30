import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PortfolioService } from './portfolio.service';

/**
 * PortfolioRefreshScheduler
 *
 * Runs a full materialized-view refresh every 5 minutes as a safety net.
 * This ensures portfolio metrics stay accurate even if an explicit
 * post-mutation invalidation was missed (e.g. a failed retirement rollback).
 *
 * The refresh is CONCURRENT — it does not block reads and is safe to run
 * while the API is serving requests.
 */
@Injectable()
export class PortfolioRefreshScheduler {
  private readonly logger = new Logger(PortfolioRefreshScheduler.name);

  constructor(private readonly portfolioService: PortfolioService) {}

  /** Refresh materialized views every 5 minutes */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async refreshViews(): Promise<void> {
    this.logger.log('Scheduled portfolio materialized view refresh started');
    try {
      await this.portfolioService.refreshMaterializedViews();
      this.logger.log('Scheduled portfolio materialized view refresh complete');
    } catch (err) {
      this.logger.error(
        `Scheduled portfolio refresh failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
