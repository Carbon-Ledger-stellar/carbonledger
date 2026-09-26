import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { PrismaService } from '../prisma.service';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/** Run archival every day at 01:00 (staggered from the midnight retention job). */
const EVERY_DAY_AT_1AM = '0 1 * * *';

/** Process at most this many AuditLog rows per archival cycle to avoid OOM. */
const ARCHIVE_BATCH_SIZE = 100;

export interface ArchivedLogEntry {
  id: string;
  originalId: string;
  userId: string | null;
  action: string;
  resourceId: string | null;
  ipAddress: string | null;
  result: string | null;
  metadata: unknown;
  timestamp: Date;
  archivedAt: Date;
  compressionType: string;
  sizeOriginal: number;
  sizeCompressed: number;
  // Hash chain fields preserved from the original row
  previousHash: string | null;
  entryHash: string | null;
}

export interface CompressionStats {
  totalArchived: number;
  avgCompressionRatio: number;
  totalBytesOriginal: number;
  totalBytesCompressed: number;
  totalBytesSaved: number;
}

export interface ArchivedLogsQuery {
  limit?: number;
  offset?: number;
  userId?: string;
  action?: string;
}

@Injectable()
export class AuditArchiveService {
  private readonly logger = new Logger(AuditArchiveService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Scheduled nightly job: archive AuditLog entries older than 6 months.
   *
   * Runs at 01:00 every day so it does not compete with the midnight
   * retention enforcement job.  Processes entries in batches of
   * ARCHIVE_BATCH_SIZE to keep memory usage predictable.
   *
   * Each archived row stores:
   *   - A copy of the query-critical scalar fields (userId, action, …)
   *   - The full row as gzip-compressed JSON — including previousHash and
   *     entryHash — so the hash chain remains verifiable after archival.
   */
  @Cron(EVERY_DAY_AT_1AM)
  async archiveOldLogs(): Promise<{ archived: number; skipped: number }> {
    const cutoff = this.getSixMonthsCutoff();
    this.logger.log(`Starting audit log archival for entries before ${cutoff.toISOString()}`);

    let totalArchived = 0;
    let totalSkipped = 0;

    // Batch loop — keep processing until no rows are left below the cutoff
    while (true) {
      const batch = await this.prisma.auditLog.findMany({
        where: { timestamp: { lt: cutoff } },
        orderBy: { timestamp: 'asc' },
        take: ARCHIVE_BATCH_SIZE,
      });

      if (batch.length === 0) {
        break;
      }

      let batchArchived = 0;
      let batchSkipped = 0;

      for (const entry of batch) {
        try {
          // Build the full JSON payload — include hash chain for audit integrity
          const payload = JSON.stringify({
            id: entry.id,
            userId: entry.userId,
            action: entry.action,
            resourceId: entry.resourceId,
            ipAddress: entry.ipAddress,
            result: entry.result,
            metadata: entry.metadata,
            timestamp: entry.timestamp.toISOString(),
            previousHash: entry.previousHash,
            entryHash: entry.entryHash,
          });

          const originalBuffer = Buffer.from(payload, 'utf8');
          const compressedBuffer = await gzip(originalBuffer);

          const sizeOriginal = originalBuffer.length;
          const sizeCompressed = compressedBuffer.length;

          await this.prisma.$transaction(async (tx) => {
            // Upsert: if already archived (e.g. a retry), skip re-insertion
            await tx.archivedAuditLog.upsert({
              where: { originalId: entry.id },
              create: {
                originalId: entry.id,
                userId: entry.userId,
                action: entry.action,
                resourceId: entry.resourceId,
                ipAddress: entry.ipAddress,
                result: entry.result,
                compressedData: compressedBuffer,
                timestamp: entry.timestamp,
                compressionType: 'gzip',
                sizeOriginal,
                sizeCompressed,
              },
              // If it already exists, leave it untouched
              update: {},
            });

            // Remove from the hot AuditLog table only after archival succeeds
            await tx.auditLog.delete({ where: { id: entry.id } });
          });

          batchArchived++;
        } catch (err) {
          this.logger.error(
            `Failed to archive AuditLog ${entry.id}: ${(err as Error).message}`,
            (err as Error).stack,
          );
          batchSkipped++;
        }
      }

      totalArchived += batchArchived;
      totalSkipped += batchSkipped;

      this.logger.log(
        `Batch complete: archived ${batchArchived}, skipped ${batchSkipped} ` +
          `(running total: ${totalArchived} archived)`,
      );

      // If the entire batch was skipped (all errors), stop to avoid an
      // infinite loop where we keep fetching the same failing rows.
      if (batchArchived === 0 && batch.length > 0) {
        this.logger.warn(
          'Entire batch was skipped due to errors — halting archival to avoid infinite loop',
        );
        break;
      }
    }

    this.logger.log(
      `Audit log archival complete: ${totalArchived} archived, ${totalSkipped} skipped`,
    );

    return { archived: totalArchived, skipped: totalSkipped };
  }

  /**
   * Retrieve archived audit log entries, decompressing each row on the fly.
   *
   * Returns entries in the same shape as AuditService.findAll() so callers
   * can merge hot and archived results without special-casing.
   *
   * Decompression is done individually per row; for typical page sizes (≤100)
   * the total time stays well below the 100 ms SLA.
   */
  async getArchivedLogs(query: ArchivedLogsQuery): Promise<{
    entries: ArchivedLogEntry[];
    total_count: number;
  }> {
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 100);
    const offset = Math.max(Number(query.offset ?? 0), 0);

    const where: Record<string, unknown> = {};
    if (query.userId) where['userId'] = query.userId;
    if (query.action) where['action'] = query.action;

    const [rows, total_count] = await Promise.all([
      this.prisma.archivedAuditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.archivedAuditLog.count({ where }),
    ]);

    const entries: ArchivedLogEntry[] = await Promise.all(
      rows.map(async (row) => {
        const decompressed = await gunzip(row.compressedData as Buffer);
        const parsed = JSON.parse(decompressed.toString('utf8')) as {
          id: string;
          userId: string | null;
          action: string;
          resourceId: string | null;
          ipAddress: string | null;
          result: string | null;
          metadata: unknown;
          timestamp: string;
          previousHash: string | null;
          entryHash: string | null;
        };

        return {
          id: row.id,
          originalId: row.originalId,
          userId: parsed.userId,
          action: parsed.action,
          resourceId: parsed.resourceId,
          ipAddress: parsed.ipAddress,
          result: parsed.result,
          metadata: parsed.metadata,
          timestamp: new Date(parsed.timestamp),
          archivedAt: row.archivedAt,
          compressionType: row.compressionType,
          sizeOriginal: row.sizeOriginal,
          sizeCompressed: row.sizeCompressed,
          previousHash: parsed.previousHash,
          entryHash: parsed.entryHash,
        };
      }),
    );

    return { entries, total_count };
  }

  /**
   * Returns aggregate compression statistics for the archived audit log.
   * Useful for dashboards and capacity planning.
   */
  async getCompressionStats(): Promise<CompressionStats> {
    const aggregate = await this.prisma.archivedAuditLog.aggregate({
      _count: { id: true },
      _sum: {
        sizeOriginal: true,
        sizeCompressed: true,
      },
      _avg: {
        sizeOriginal: true,
        sizeCompressed: true,
      },
    });

    const totalArchived = aggregate._count.id;
    const totalBytesOriginal = aggregate._sum.sizeOriginal ?? 0;
    const totalBytesCompressed = aggregate._sum.sizeCompressed ?? 0;
    const totalBytesSaved = totalBytesOriginal - totalBytesCompressed;

    const avgOriginal = aggregate._avg.sizeOriginal ?? 0;
    const avgCompressed = aggregate._avg.sizeCompressed ?? 0;
    // Compression ratio: (1 - compressed/original) * 100, expressed as a percentage
    const avgCompressionRatio =
      avgOriginal > 0 ? (1 - avgCompressed / avgOriginal) * 100 : 0;

    return {
      totalArchived,
      avgCompressionRatio: Math.round(avgCompressionRatio * 100) / 100,
      totalBytesOriginal,
      totalBytesCompressed,
      totalBytesSaved,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getSixMonthsCutoff(): Date {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 6);
    return cutoff;
  }
}
