import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { SlackService } from './slack.service';

/**
 * StatsSchedulerService
 *
 * Sends the daily CarbonLedger digest to Slack at 09:00 UTC every day.
 * Requires @nestjs/schedule to be registered in AppModule.
 */
@Injectable()
export class StatsSchedulerService {
  private readonly logger = new Logger(StatsSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly slack: SlackService,
  ) {}

  /** Runs at 09:00 UTC daily. */
  @Cron('0 9 * * *', { timeZone: 'UTC' })
  async sendDailyDigest(): Promise<void> {
    this.logger.log('Sending daily Slack digest...');

    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [activeListings, transactions24h, creditsRetired24h, newUsers24h, errors24h] =
        await Promise.all([
          this.prisma.marketListing.count({ where: { status: { in: ['Active', 'PartiallyFilled'] } } }),
          this.prisma.retirementRecord.count({ where: { retiredAt: { gte: since } } }),
          this.prisma.retirementRecord.aggregate({
            _sum: { amount: true },
            where: { retiredAt: { gte: since } },
          }),
          this.prisma.user.count({ where: { createdAt: { gte: since } } }),
          this.prisma.emailLog.count({ where: { status: 'Failed', createdAt: { gte: since } } }),
        ]);

      await this.slack.sendDailyDigest({
        activeListings,
        transactions24h,
        creditsRetired24h: Number(creditsRetired24h._sum.amount ?? 0),
        revenueUsdc24h: 0, // Revenue tracking requires marketplace purchase records — extend when available
        newUsers24h,
        errors24h,
      });

      this.logger.log('Daily Slack digest sent successfully');
    } catch (error) {
      this.logger.error(
        'Failed to build daily digest stats',
        error instanceof Error ? error.stack : String(error),
      );
      // Still attempt to send a partial digest so the team knows something ran
      await this.slack.notifyError({
        title: 'Daily Digest Failed',
        message: 'Could not gather all stats for the daily digest. See backend logs.',
        severity: 'warning',
      });
    }
  }
}
