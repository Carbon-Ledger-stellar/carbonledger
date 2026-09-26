import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

/**
 * TemporalService manages system-versioned temporal tables for complete audit trails.
 * 
 * On every mutation to a source table (CarbonProject, CreditBatch, RetirementRecord),
 * this service:
 * 1. Marks the previous active version with ended_at := now()
 * 2. Inserts a new version with started_at := now(), ended_at := null
 * 3. Logs the full state change to the history table
 * 
 * This enables point-in-time queries and full compliance audit trails.
 */
@Injectable()
export class TemporalService {
  private readonly logger = new Logger(TemporalService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a new version of a CarbonProject.
   * Called whenever a project is created or updated.
   */
  async recordProjectVersion(
    projectId: string,
    currentState: any,
    previousState?: any,
  ): Promise<void> {
    try {
      // If there was a previous version, mark it as ended
      if (previousState) {
        await this.prisma.carbonProjectHistory.create({
          data: {
            ...previousState,
            ended_at: new Date(),
          },
        });
      }

      // Insert new version
      await this.prisma.carbonProjectHistory.create({
        data: {
          ...currentState,
          started_at: new Date(),
          ended_at: null,
        },
      });

      this.logger.debug(
        `Recorded project version: ${projectId} at ${new Date().toISOString()}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to record project version for ${projectId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Record a new version of a CreditBatch.
   * Called whenever a batch is created or updated.
   */
  async recordBatchVersion(
    batchId: string,
    currentState: any,
    previousState?: any,
  ): Promise<void> {
    try {
      if (previousState) {
        await this.prisma.creditBatchHistory.create({
          data: {
            ...previousState,
            ended_at: new Date(),
          },
        });
      }

      await this.prisma.creditBatchHistory.create({
        data: {
          ...currentState,
          started_at: new Date(),
          ended_at: null,
        },
      });

      this.logger.debug(
        `Recorded batch version: ${batchId} at ${new Date().toISOString()}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to record batch version for ${batchId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Record a new version of a RetirementRecord.
   * Called whenever a retirement is created or updated.
   */
  async recordRetirementVersion(
    retirementId: string,
    currentState: any,
    previousState?: any,
  ): Promise<void> {
    try {
      if (previousState) {
        await this.prisma.retirementRecordHistory.create({
          data: {
            ...previousState,
            ended_at: new Date(),
          },
        });
      }

      await this.prisma.retirementRecordHistory.create({
        data: {
          ...currentState,
          started_at: new Date(),
          ended_at: null,
        },
      });

      this.logger.debug(
        `Recorded retirement version: ${retirementId} at ${new Date().toISOString()}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to record retirement version for ${retirementId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Query the state of an entity at a specific point in time.
   * 
   * @param entityType 'project' | 'batch' | 'retirement'
   * @param entityId The ID of the entity
   * @param timestamp The point-in-time to query
   * @returns The state at that timestamp, or null if entity didn't exist then
   */
  async getStateAtTime(
    entityType: 'project' | 'batch' | 'retirement',
    entityId: string,
    timestamp: Date,
  ): Promise<any | null> {
    try {
      let result;

      switch (entityType) {
        case 'project':
          result = await this.prisma.carbonProjectHistory.findFirst({
            where: {
              projectId: entityId,
              started_at: { lte: timestamp },
              OR: [
                { ended_at: null },
                { ended_at: { gt: timestamp } },
              ],
            },
            orderBy: { started_at: 'desc' },
          });
          break;

        case 'batch':
          result = await this.prisma.creditBatchHistory.findFirst({
            where: {
              batchId: entityId,
              started_at: { lte: timestamp },
              OR: [
                { ended_at: null },
                { ended_at: { gt: timestamp } },
              ],
            },
            orderBy: { started_at: 'desc' },
          });
          break;

        case 'retirement':
          result = await this.prisma.retirementRecordHistory.findFirst({
            where: {
              retirementId: entityId,
              started_at: { lte: timestamp },
              OR: [
                { ended_at: null },
                { ended_at: { gt: timestamp } },
              ],
            },
            orderBy: { started_at: 'desc' },
          });
          break;

        default:
          throw new Error(`Unknown entity type: ${entityType}`);
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to query ${entityType} state at ${timestamp}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get the complete history (all versions) of an entity.
   * Ordered from oldest to newest.
   */
  async getFullHistory(
    entityType: 'project' | 'batch' | 'retirement',
    entityId: string,
  ): Promise<any[]> {
    try {
      let result;

      switch (entityType) {
        case 'project':
          result = await this.prisma.carbonProjectHistory.findMany({
            where: { projectId: entityId },
            orderBy: { started_at: 'asc' },
          });
          break;

        case 'batch':
          result = await this.prisma.creditBatchHistory.findMany({
            where: { batchId: entityId },
            orderBy: { started_at: 'asc' },
          });
          break;

        case 'retirement':
          result = await this.prisma.retirementRecordHistory.findMany({
            where: { retirementId: entityId },
            orderBy: { started_at: 'asc' },
          });
          break;

        default:
          throw new Error(`Unknown entity type: ${entityType}`);
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get history for ${entityType}:${entityId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get all changes to an entity within a time range.
   */
  async getChangesInRange(
    entityType: 'project' | 'batch' | 'retirement',
    entityId: string,
    startTime: Date,
    endTime: Date,
  ): Promise<any[]> {
    try {
      let result;

      switch (entityType) {
        case 'project':
          result = await this.prisma.carbonProjectHistory.findMany({
            where: {
              projectId: entityId,
              started_at: { gte: startTime, lte: endTime },
            },
            orderBy: { started_at: 'asc' },
          });
          break;

        case 'batch':
          result = await this.prisma.creditBatchHistory.findMany({
            where: {
              batchId: entityId,
              started_at: { gte: startTime, lte: endTime },
            },
            orderBy: { started_at: 'asc' },
          });
          break;

        case 'retirement':
          result = await this.prisma.retirementRecordHistory.findMany({
            where: {
              retirementId: entityId,
              started_at: { gte: startTime, lte: endTime },
            },
            orderBy: { started_at: 'asc' },
          });
          break;

        default:
          throw new Error(`Unknown entity type: ${entityType}`);
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get changes for ${entityType}:${entityId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Archive old history entries to cold storage (e.g., S3).
   * Called monthly to keep production database lean.
   * 
   * @param olderThanDate Archive history entries older than this date
   * @param entityType Entity type to archive (or 'all' for all types)
   */
  async archiveHistoryBefore(
    olderThanDate: Date,
    entityType: 'project' | 'batch' | 'retirement' | 'all' = 'all',
  ): Promise<number> {
    try {
      let deletedCount = 0;

      if (entityType === 'project' || entityType === 'all') {
        const result = await this.prisma.carbonProjectHistory.deleteMany({
          where: {
            ended_at: { lt: olderThanDate },
          },
        });
        deletedCount += result.count;
        this.logger.log(
          `Archived ${result.count} project history entries before ${olderThanDate}`,
        );
      }

      if (entityType === 'batch' || entityType === 'all') {
        const result = await this.prisma.creditBatchHistory.deleteMany({
          where: {
            ended_at: { lt: olderThanDate },
          },
        });
        deletedCount += result.count;
        this.logger.log(
          `Archived ${result.count} batch history entries before ${olderThanDate}`,
        );
      }

      if (entityType === 'retirement' || entityType === 'all') {
        const result = await this.prisma.retirementRecordHistory.deleteMany({
          where: {
            ended_at: { lt: olderThanDate },
          },
        });
        deletedCount += result.count;
        this.logger.log(
          `Archived ${result.count} retirement history entries before ${olderThanDate}`,
        );
      }

      return deletedCount;
    } catch (error) {
      this.logger.error(
        `Failed to archive history before ${olderThanDate}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Compute storage overhead of history tables compared to active tables.
   * Useful for capacity planning.
   */
  async computeStorageOverhead(): Promise<{
    activeSize: number;
    historySize: number;
    totalSize: number;
    overheadPercentage: number;
  }> {
    try {
      // Raw SQL query to get table sizes (PostgreSQL-specific)
      const result = await this.prisma.$queryRaw<
        { table_name: string; size_bytes: bigint }[]
      >`
        SELECT
          schemaname || '.' || tablename as table_name,
          pg_total_relation_size(schemaname || '.' || tablename)::bigint as size_bytes
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN (
            'CarbonProject', 'CreditBatch', 'RetirementRecord',
            'CarbonProjectHistory', 'CreditBatchHistory', 'RetirementRecordHistory'
          )
      `;

      let activeSize = 0n;
      let historySize = 0n;

      for (const row of result) {
        if (
          row.table_name.includes('CarbonProject') ||
          row.table_name.includes('CreditBatch') ||
          row.table_name.includes('RetirementRecord')
        ) {
          if (!row.table_name.includes('History')) {
            activeSize += row.size_bytes;
          } else {
            historySize += row.size_bytes;
          }
        }
      }

      const totalSize = activeSize + historySize;
      const overheadPercentage =
        totalSize > 0n ? (Number(historySize) / Number(totalSize)) * 100 : 0;

      return {
        activeSize: Number(activeSize),
        historySize: Number(historySize),
        totalSize: Number(totalSize),
        overheadPercentage,
      };
    } catch (error) {
      this.logger.error('Failed to compute storage overhead:', error);
      throw error;
    }
  }
}
