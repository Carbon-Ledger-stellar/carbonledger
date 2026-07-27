import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { OracleContractClient } from './oracle-contract.client';

interface SyncResult {
  recordsSynced: number;
  newRecords: number;
  updatedRecords: number;
  errors: string[];
  duration: number;
}

@Injectable()
export class OracleSyncService {
  private readonly logger = new Logger(OracleSyncService.name);
  private isSyncing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly contractClient: OracleContractClient
  ) {}

  /**
   * Performs a full sync of oracle monitoring data from the contract to the database.
   * This is the main entry point for the scheduled sync job.
   *
   * @returns Sync result with statistics
   */
  async syncMonitoringData(): Promise<SyncResult> {
    if (this.isSyncing) {
      this.logger.warn('Sync already in progress, skipping this cycle');
      return {
        recordsSynced: 0,
        newRecords: 0,
        updatedRecords: 0,
        errors: ['Sync already in progress'],
        duration: 0,
      };
    }

    const startTime = Date.now();
    this.isSyncing = true;

    try {
      this.logger.log('Starting oracle monitoring data sync...');

      // Get the last sync state
      const syncState = await this.getOrCreateSyncState();

      // Update sync status to "syncing"
      await this.prisma.oracleSyncState.update({
        where: { id: syncState.id },
        data: { syncStatus: 'syncing' },
      });

      // Fetch monitoring data from contract since last sync
      const contractData = await this.contractClient.getMonitoringDataSince(
        Math.floor(syncState.lastSyncedAt.getTime() / 1000)
      );

      this.logger.log(`Retrieved ${contractData.length} records from contract`);

      // Upsert records into database
      let newRecords = 0;
      let updatedRecords = 0;
      const errors: string[] = [];

      for (const record of contractData) {
        try {
          const result = await this.prisma.monitoringData.upsert({
            where: {
              projectId_period: {
                projectId: record.projectId,
                period: record.period,
              },
            },
            update: {
              tonnesVerified: record.tonnesVerified,
              methodologyScore: record.methodologyScore,
              satelliteCid: record.satelliteCid,
              submittedBy: record.submittedBy,
              submittedAt: new Date(record.submittedAt * 1000),
            },
            create: {
              projectId: record.projectId,
              period: record.period,
              tonnesVerified: record.tonnesVerified,
              methodologyScore: record.methodologyScore,
              satelliteCid: record.satelliteCid,
              submittedBy: record.submittedBy,
              submittedAt: new Date(record.submittedAt * 1000),
            },
          });

          // Track if this was a new record or update
          // Note: Prisma upsert doesn't tell us if it was created or updated,
          // so we check if submittedAt matches the contract timestamp
          if (
            result.submittedAt.getTime() === record.submittedAt * 1000
          ) {
            newRecords++;
          } else {
            updatedRecords++;
          }
        } catch (error) {
          const errorMsg = `Failed to upsert record for project ${record.projectId}, period ${record.period}: ${error instanceof Error ? error.message : String(error)}`;
          this.logger.error(errorMsg);
          errors.push(errorMsg);
        }
      }

      const totalRecords = newRecords + updatedRecords;

      // Update sync state
      const now = new Date();
      await this.prisma.oracleSyncState.update({
        where: { id: syncState.id },
        data: {
          lastSyncedAt: now,
          recordsSynced: totalRecords,
          syncStatus: 'completed',
          lastError: errors.length > 0 ? errors.join('; ') : null,
          lastErrorAt: errors.length > 0 ? now : null,
        },
      });

      const duration = Date.now() - startTime;

      this.logger.log(
        `Oracle sync completed: ${totalRecords} records (${newRecords} new, ${updatedRecords} updated) in ${duration}ms`
      );

      return {
        recordsSynced: totalRecords,
        newRecords,
        updatedRecords,
        errors,
        duration,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Oracle sync failed: ${errorMsg}`, error instanceof Error ? error.stack : undefined);

      // Update sync state with error
      try {
        const syncState = await this.getOrCreateSyncState();
        const now = new Date();
        await this.prisma.oracleSyncState.update({
          where: { id: syncState.id },
          data: {
            syncStatus: 'failed',
            lastError: errorMsg,
            lastErrorAt: now,
          },
        });
      } catch (updateError) {
        this.logger.error(`Failed to update sync state: ${updateError}`);
      }

      return {
        recordsSynced: 0,
        newRecords: 0,
        updatedRecords: 0,
        errors: [errorMsg],
        duration: Date.now() - startTime,
      };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Gets the current sync state or creates a new one if it doesn't exist.
   *
   * @returns Current sync state
   */
  private async getOrCreateSyncState() {
    let syncState = await this.prisma.oracleSyncState.findFirst();

    if (!syncState) {
      syncState = await this.prisma.oracleSyncState.create({
        data: {
          lastSyncedAt: new Date(0), // Start from epoch
          lastSyncedBlock: 0,
          recordsSynced: 0,
          syncStatus: 'idle',
        },
      });
    }

    return syncState;
  }

  /**
   * Gets the current sync state for monitoring/debugging.
   *
   * @returns Current sync state
   */
  async getSyncState() {
    return this.prisma.oracleSyncState.findFirst();
  }

  /**
   * Manually triggers a sync (for testing or manual intervention).
   *
   * @returns Sync result
   */
  async triggerManualSync(): Promise<SyncResult> {
    this.logger.log('Manual sync triggered');
    return this.syncMonitoringData();
  }

  /**
   * Resets the sync state (for testing or recovery).
   */
  async resetSyncState() {
    this.logger.warn('Resetting oracle sync state');
    await this.prisma.oracleSyncState.deleteMany();
    await this.getOrCreateSyncState();
  }
}
