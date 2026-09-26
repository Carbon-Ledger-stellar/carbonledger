import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';

export const SERIAL_RECONCILIATION_QUEUE = 'serial-reconciliation';
export const SERIAL_RECONCILIATION_JOB = 'run-serial-reconciliation';

export interface SerialRange {
  serialStart: bigint;
  serialEnd: bigint;
}

export interface OnChainRange {
  serialStart: string;
  serialEnd: string;
  source: 'on-chain';
}

export interface ConflictDetail {
  batchId: string;
  serialStart: string;
  serialEnd: string;
  conflictType: 'db_only' | 'on_chain_only' | 'overlap';
  overlappingWith?: string; // batchId or on-chain identifier
  overlapStart?: string;
  overlapEnd?: string;
}

export interface ReconciliationReport {
  generatedAt: string;
  totalBatchesChecked: number;
  totalOnChainRangesChecked: number;
  discrepanciesFound: number;
  dbOnlyBatches: ConflictDetail[];
  onChainOnlyRanges: ConflictDetail[];
  overlappingRanges: ConflictDetail[];
}

@Injectable()
export class SerialReconciliationService {
  private readonly logger = new Logger(SerialReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(SERIAL_RECONCILIATION_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Enqueue a serial range reconciliation job and return the job ID for polling.
   */
  async enqueueReconciliation(): Promise<{ jobId: string; message: string }> {
    const job = await this.queue.add(
      SERIAL_RECONCILIATION_JOB,
      { triggeredAt: new Date().toISOString() },
      { removeOnComplete: false, removeOnFail: false },
    );
    this.logger.log(`Serial reconciliation job enqueued: ${job.id}`);
    return {
      jobId: job.id as string,
      message: 'Reconciliation job enqueued. Poll GET /admin/reconciliation/:jobId for status.',
    };
  }

  /**
   * Poll a job's status and return the report if complete.
   */
  async getJobStatus(jobId: string): Promise<{
    jobId: string;
    status: string;
    progress?: number;
    report?: ReconciliationReport;
    error?: string;
  }> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      return { jobId, status: 'not_found' };
    }

    const state = await job.getState();
    const returnValue = job.returnvalue as ReconciliationReport | undefined;

    return {
      jobId,
      status: state,
      progress: job.progress as number | undefined,
      report: state === 'completed' ? returnValue : undefined,
      error: state === 'failed' ? (job.failedReason ?? 'Unknown error') : undefined,
    };
  }

  /**
   * Export a completed job's report as CSV.
   */
  async exportJobAsCsv(jobId: string): Promise<string> {
    const job = await this.queue.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    const state = await job.getState();
    if (state !== 'completed') throw new Error(`Job ${jobId} is not completed (status: ${state})`);

    const report = job.returnvalue as ReconciliationReport;
    return this.buildCsv(report);
  }

  /**
   * Run the reconciliation synchronously. Called by the BullMQ processor
   * and the nightly cron.
   */
  async runReconciliation(onProgress?: (pct: number) => Promise<void>): Promise<ReconciliationReport> {
    this.logger.log('Starting serial range reconciliation');

    // 1. Fetch all DB batches ordered by serialStart (numeric sort via BigInt)
    const dbBatches = await this.prisma.creditBatch.findMany({
      select: { batchId: true, serialStart: true, serialEnd: true },
    });

    // Sort numerically
    dbBatches.sort((a, b) => {
      const diff = BigInt(a.serialStart) - BigInt(b.serialStart);
      return diff < 0n ? -1 : diff > 0n ? 1 : 0;
    });

    await onProgress?.(20);

    // 2. Fetch on-chain ranges (stubbed — in production, read from Soroban SerialRegistry)
    const onChainRanges = await this.fetchOnChainRanges();

    await onProgress?.(50);

    // 3. Compute set differences and overlaps
    const dbOnlyBatches = this.findDbOnlyBatches(dbBatches, onChainRanges);
    const onChainOnlyRanges = this.findOnChainOnlyRanges(dbBatches, onChainRanges);
    const overlapping = this.findOverlappingRanges(dbBatches);

    await onProgress?.(90);

    const report: ReconciliationReport = {
      generatedAt: new Date().toISOString(),
      totalBatchesChecked: dbBatches.length,
      totalOnChainRangesChecked: onChainRanges.length,
      discrepanciesFound: dbOnlyBatches.length + onChainOnlyRanges.length + overlapping.length,
      dbOnlyBatches,
      onChainOnlyRanges,
      overlappingRanges: overlapping,
    };

    if (report.discrepanciesFound > 0) {
      this.logger.warn(
        `Serial reconciliation found ${report.discrepanciesFound} discrepancies`,
        {
          dbOnly: dbOnlyBatches.length,
          onChainOnly: onChainOnlyRanges.length,
          overlapping: overlapping.length,
        },
      );
    } else {
      this.logger.log('Serial reconciliation: no discrepancies found');
    }

    await onProgress?.(100);
    return report;
  }

  // ── Nightly cron ──────────────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async nightlyReconciliation(): Promise<void> {
    this.logger.log('Nightly serial reconciliation triggered by cron');
    try {
      const report = await this.runReconciliation();
      if (report.discrepanciesFound > 0) {
        this.logger.error(
          `ALERT: Nightly serial reconciliation found ${report.discrepanciesFound} discrepancies. ` +
          `DB-only: ${report.dbOnlyBatches.length}, On-chain-only: ${report.onChainOnlyRanges.length}, ` +
          `Overlapping: ${report.overlappingRanges.length}`,
        );
        // In production: emit to alerting service / PagerDuty
      }
    } catch (err: any) {
      this.logger.error('Nightly serial reconciliation failed', err.message);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Fetch on-chain serial ranges from the Soroban carbon_credit SerialRegistry.
   *
   * In production this would call:
   *   SorobanRpc.Server → simulateTransaction → get_all_serial_ranges
   *
   * For now returns an empty array so the service compiles and tests can
   * inject mock data via the processor.
   */
  private async fetchOnChainRanges(): Promise<OnChainRange[]> {
    try {
      // TODO: integrate with StellarNetworkService / SorobanRpc.Server
      // const server = new SorobanRpc.Server(process.env.SOROBAN_RPC_URL);
      // const result = await server.simulateTransaction(...);
      return [];
    } catch (err: any) {
      this.logger.warn('Could not fetch on-chain serial ranges; treating as empty', err.message);
      return [];
    }
  }

  /**
   * Ranges present in the DB but not on-chain.
   */
  private findDbOnlyBatches(
    dbBatches: Array<{ batchId: string; serialStart: string; serialEnd: string }>,
    onChainRanges: OnChainRange[],
  ): ConflictDetail[] {
    if (onChainRanges.length === 0) return []; // can't determine without on-chain data

    const onChainSet = new Set(
      onChainRanges.map((r) => `${r.serialStart}:${r.serialEnd}`),
    );

    return dbBatches
      .filter((b) => !onChainSet.has(`${b.serialStart}:${b.serialEnd}`))
      .map((b) => ({
        batchId: b.batchId,
        serialStart: b.serialStart,
        serialEnd: b.serialEnd,
        conflictType: 'db_only' as const,
      }));
  }

  /**
   * Ranges present on-chain but not in the DB.
   */
  private findOnChainOnlyRanges(
    dbBatches: Array<{ batchId: string; serialStart: string; serialEnd: string }>,
    onChainRanges: OnChainRange[],
  ): ConflictDetail[] {
    if (onChainRanges.length === 0) return [];

    const dbSet = new Set(dbBatches.map((b) => `${b.serialStart}:${b.serialEnd}`));

    return onChainRanges
      .filter((r) => !dbSet.has(`${r.serialStart}:${r.serialEnd}`))
      .map((r, i) => ({
        batchId: `on-chain-${i}`,
        serialStart: r.serialStart,
        serialEnd: r.serialEnd,
        conflictType: 'on_chain_only' as const,
      }));
  }

  /**
   * Detect overlapping serial ranges in the DB (the primary double-counting signal).
   *
   * Uses a sweep-line algorithm: sort by serialStart, then check each range
   * against the previous one. O(n log n) for the sort, O(n) for the sweep.
   */
  private findOverlappingRanges(
    sortedBatches: Array<{ batchId: string; serialStart: string; serialEnd: string }>,
  ): ConflictDetail[] {
    const conflicts: ConflictDetail[] = [];

    for (let i = 1; i < sortedBatches.length; i++) {
      const prev = sortedBatches[i - 1];
      const curr = sortedBatches[i];

      const prevEnd = BigInt(prev.serialEnd);
      const currStart = BigInt(curr.serialStart);
      const currEnd = BigInt(curr.serialEnd);

      if (currStart <= prevEnd) {
        // Overlap detected
        const overlapStart = currStart;
        const overlapEnd = prevEnd < currEnd ? prevEnd : currEnd;

        conflicts.push({
          batchId: curr.batchId,
          serialStart: curr.serialStart,
          serialEnd: curr.serialEnd,
          conflictType: 'overlap',
          overlappingWith: prev.batchId,
          overlapStart: overlapStart.toString(),
          overlapEnd: overlapEnd.toString(),
        });
      }
    }

    return conflicts;
  }

  /**
   * Build a CSV string from the reconciliation report.
   */
  private buildCsv(report: ReconciliationReport): string {
    const rows: string[] = [
      '# CarbonLedger Serial Range Reconciliation Report',
      `# Generated: ${report.generatedAt}`,
      `# Total Batches Checked: ${report.totalBatchesChecked}`,
      `# Total On-Chain Ranges: ${report.totalOnChainRangesChecked}`,
      `# Discrepancies Found: ${report.discrepanciesFound}`,
      '',
      'batchId,serialStart,serialEnd,conflictType,overlappingWith,overlapStart,overlapEnd',
    ];

    const allConflicts = [
      ...report.dbOnlyBatches,
      ...report.onChainOnlyRanges,
      ...report.overlappingRanges,
    ];

    for (const c of allConflicts) {
      rows.push(
        [
          c.batchId,
          c.serialStart,
          c.serialEnd,
          c.conflictType,
          c.overlappingWith ?? '',
          c.overlapStart ?? '',
          c.overlapEnd ?? '',
        ]
          .map((v) => `"${v}"`)
          .join(','),
      );
    }

    return rows.join('\n');
  }
}
