import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OracleSyncService } from './oracle-sync.service';

/**
 * Scheduled tasks for oracle monitoring data synchronization.
 * Runs every 6 hours to sync monitoring data from the contract to the database.
 */
@Injectable()
export class OracleSchedulerService {
  private readonly logger = new Logger(OracleSchedulerService.name);

  constructor(private readonly oracleSyncService: OracleSyncService) {}

  /**
   * Scheduled task that runs every 6 hours (at 0:00, 6:00, 12:00, 18:00 UTC).
   * Syncs oracle monitoring data from the contract to the database.
   *
   * Cron expression: 0 0 */6 * * *
   * - 0 seconds
   * - 0 minutes
   * - */6 hours (every 6 hours)
   * - * any day of month
   * - * any month
   * - * any day of week
   */
  @Cron('0 0 */6 * * *')
  async syncOracleData() {
    this.logger.log('Starting scheduled oracle monitoring data sync (every 6 hours)');

    try {
      const result = await this.oracleSyncService.syncMonitoringData();

      this.logger.log(
        `Scheduled sync completed: ${result.recordsSynced} records synced (${result.newRecords} new, ${result.updatedRecords} updated) in ${result.duration}ms`
      );

      // Log any errors that occurred during sync
      if (result.errors.length > 0) {
        this.logger.warn(`Sync completed with ${result.errors.length} errors:`);
        result.errors.forEach((error) => this.logger.warn(`  - ${error}`));
      }
    } catch (error) {
      this.logger.error(
        `Scheduled sync failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined
      );

      // Send alert notification (implement based on your alerting system)
      await this.sendSyncFailureAlert(error);
    }
  }

  /**
   * Sends an alert when the sync fails.
   * This can be extended to send emails, Slack messages, etc.
   *
   * @param error - The error that occurred
   */
  private async sendSyncFailureAlert(error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    this.logger.error(`Sending sync failure alert: ${errorMsg}`);

    // TODO: Implement alerting mechanism
    // Examples:
    // - Send email to admin
    // - Send Slack message
    // - Send webhook to monitoring service
    // - Create incident in incident management system

    // For now, just log it
    this.logger.warn(`ALERT: Oracle sync failed - ${errorMsg}`);
  }

  /**
   * Health check for the scheduler.
   * Returns the current sync state.
   *
   * @returns Current sync state
   */
  async getSchedulerHealth() {
    const syncState = await this.oracleSyncService.getSyncState();

    return {
      status: syncState?.syncStatus || 'unknown',
      lastSyncedAt: syncState?.lastSyncedAt || null,
      recordsSynced: syncState?.recordsSynced || 0,
      lastError: syncState?.lastError || null,
      lastErrorAt: syncState?.lastErrorAt || null,
    };
  }
}
