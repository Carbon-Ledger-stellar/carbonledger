import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

/**
 * Snapshot of migration health metrics at a point in time.
 */
export interface MigrationHealthSnapshot {
  /** ISO timestamp of the snapshot */
  timestamp: string;
  /** Number of applied migrations found in the migrations directory */
  appliedMigrationCount: number;
  /** Whether the database is reachable */
  databaseReachable: boolean;
  /** p50 query latency in milliseconds (last 100 queries) */
  queryLatencyP50Ms: number;
  /** p99 query latency in milliseconds (last 100 queries) */
  queryLatencyP99Ms: number;
  /** Number of pool-timeout errors (Prisma P2024) observed since startup */
  poolTimeoutErrors: number;
  /** Active DB connections as a fraction of the pool maximum */
  poolUtilisation: number;
  /** HTTP 5xx error count since last snapshot (populated externally) */
  http5xxCount: number;
  /** Current backfill progress keyed by migration label (0–1) */
  backfillProgress: Record<string, number>;
}

/**
 * Backfill job registration used by callers to report progress.
 */
export interface BackfillJobHandle {
  /** Human-readable label for the migration this backfill belongs to */
  label: string;
  /** Total rows that need to be backfilled */
  total: number;
  /** Rows processed so far */
  processed: number;
}

/**
 * MigrationMonitorService
 *
 * Centralises observability hooks for zero-downtime Prisma migrations:
 *
 *  - Query latency histogram (ring buffer of recent durations).
 *  - Backfill progress registry (callers report processed / total rows).
 *  - Pool utilisation from PrismaService metrics.
 *  - HTTP 5xx counter (updated by the logging interceptor).
 *  - `getHealthSnapshot()` returns a structured report suitable for a
 *    Prometheus text-format endpoint or a Grafana dashboard.
 *
 * Usage:
 *
 *   // In a migration backfill script or service:
 *   const handle = this.monitor.registerBackfill('rename_retirement_reason', totalRows);
 *   for (const batch of batches) {
 *     await processBatch(batch);
 *     this.monitor.updateBackfill(handle, batch.length);
 *   }
 *   this.monitor.completeBackfill(handle);
 *
 *   // The backfill progress is then visible in getHealthSnapshot().
 */
@Injectable()
export class MigrationMonitorService implements OnModuleInit {
  private readonly logger = new Logger(MigrationMonitorService.name);

  /** Ring-buffer of the last 100 query durations (ms) */
  private readonly queryLatencies: number[] = [];
  private readonly maxLatencySamples = 100;

  /** Active backfill jobs keyed by label */
  private readonly backfillJobs = new Map<string, BackfillJobHandle>();

  /** HTTP 5xx counter — incremented by the logging interceptor */
  private http5xxCount = 0;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.logger.log('MigrationMonitorService initialised');
  }

  // ─── Query Latency ──────────────────────────────────────────────────────────

  /**
   * Record a query duration sample.  Call this from the PrismaService middleware
   * or the logging interceptor after every database query.
   */
  recordQueryDuration(durationMs: number): void {
    if (this.queryLatencies.length >= this.maxLatencySamples) {
      this.queryLatencies.shift();
    }
    this.queryLatencies.push(durationMs);
  }

  /**
   * Compute a percentile over the current latency ring-buffer.
   * Returns 0 if no samples have been recorded yet.
   */
  getLatencyPercentile(percentile: number): number {
    if (this.queryLatencies.length === 0) return 0;
    const sorted = [...this.queryLatencies].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  // ─── Backfill Registry ───────────────────────────────────────────────────────

  /**
   * Register a new backfill job.  Returns a handle that must be passed to
   * `updateBackfill()` and `completeBackfill()`.
   *
   * @param label     A unique, human-readable identifier (e.g. migration dir name).
   * @param totalRows Total number of rows to backfill.
   */
  registerBackfill(label: string, totalRows: number): BackfillJobHandle {
    const handle: BackfillJobHandle = { label, total: totalRows, processed: 0 };
    this.backfillJobs.set(label, handle);
    this.logger.log(`Backfill started: ${label} — ${totalRows} rows`);
    return handle;
  }

  /**
   * Increment the processed-row counter for an active backfill.
   *
   * @param handle        The handle returned by `registerBackfill`.
   * @param rowsProcessed Number of rows processed in this batch.
   */
  updateBackfill(handle: BackfillJobHandle, rowsProcessed: number): void {
    handle.processed = Math.min(handle.processed + rowsProcessed, handle.total);
    const pct = handle.total > 0 ? Math.round((handle.processed / handle.total) * 100) : 100;
    this.logger.debug(`Backfill progress: ${handle.label} — ${handle.processed}/${handle.total} (${pct}%)`);
  }

  /**
   * Mark a backfill as complete.  The progress entry will show 1.0 (100%).
   */
  completeBackfill(handle: BackfillJobHandle): void {
    handle.processed = handle.total;
    this.logger.log(`Backfill complete: ${handle.label}`);
  }

  /**
   * Remove a completed backfill from the registry.
   */
  deregisterBackfill(label: string): void {
    this.backfillJobs.delete(label);
  }

  /**
   * Returns the current progress for all registered backfill jobs as a map
   * of label → fraction-complete (0–1).
   */
  getBackfillProgress(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [label, job] of this.backfillJobs) {
      result[label] = job.total > 0 ? job.processed / job.total : 1;
    }
    return result;
  }

  // ─── HTTP 5xx Counter ────────────────────────────────────────────────────────

  /**
   * Increment the HTTP 5xx counter.  Called by the logging interceptor.
   */
  recordHttp5xx(): void {
    this.http5xxCount += 1;
  }

  /**
   * Reset the HTTP 5xx counter (e.g. after each monitoring snapshot).
   */
  resetHttp5xxCount(): void {
    this.http5xxCount = 0;
  }

  // ─── Health Snapshot ─────────────────────────────────────────────────────────

  /**
   * Assemble a complete health snapshot.  Expose this via an internal HTTP
   * endpoint or push to a time-series store during migrations.
   *
   * @example
   *   // In a monitoring controller:
   *   @Get('migration-health')
   *   async migrationHealth() {
   *     return this.migrationMonitor.getHealthSnapshot();
   *   }
   */
  async getHealthSnapshot(): Promise<MigrationHealthSnapshot> {
    const databaseReachable = await this.isDatabaseReachable();
    const poolMetrics = this.prisma.getPoolMetrics();

    const snapshot: MigrationHealthSnapshot = {
      timestamp: new Date().toISOString(),
      appliedMigrationCount: await this.countAppliedMigrations(),
      databaseReachable,
      queryLatencyP50Ms: this.getLatencyPercentile(50),
      queryLatencyP99Ms: this.getLatencyPercentile(99),
      poolTimeoutErrors: poolMetrics.pool_timeout_errors,
      poolUtilisation:
        poolMetrics.pool_max > 0
          ? poolMetrics.active_queries / poolMetrics.pool_max
          : 0,
      http5xxCount: this.http5xxCount,
      backfillProgress: this.getBackfillProgress(),
    };

    this.logger.debug(`Migration health snapshot: ${JSON.stringify(snapshot)}`);
    return snapshot;
  }

  /**
   * Emit a Prometheus-compatible text-format export of the core migration
   * metrics.  Mount this at `/metrics/migration` for Grafana scraping.
   */
  async toPrometheusText(): Promise<string> {
    const snap = await this.getHealthSnapshot();
    const lines: string[] = [
      '# HELP migration_query_latency_p50_ms p50 query latency over last 100 queries',
      '# TYPE migration_query_latency_p50_ms gauge',
      `migration_query_latency_p50_ms ${snap.queryLatencyP50Ms}`,
      '',
      '# HELP migration_query_latency_p99_ms p99 query latency over last 100 queries',
      '# TYPE migration_query_latency_p99_ms gauge',
      `migration_query_latency_p99_ms ${snap.queryLatencyP99Ms}`,
      '',
      '# HELP migration_db_pool_utilisation Active / max pool connections (0-1)',
      '# TYPE migration_db_pool_utilisation gauge',
      `migration_db_pool_utilisation ${snap.poolUtilisation.toFixed(4)}`,
      '',
      '# HELP migration_pool_timeout_errors_total Cumulative Prisma P2024 errors',
      '# TYPE migration_pool_timeout_errors_total counter',
      `migration_pool_timeout_errors_total ${snap.poolTimeoutErrors}`,
      '',
      '# HELP migration_http_5xx_count HTTP 5xx responses since last reset',
      '# TYPE migration_http_5xx_count gauge',
      `migration_http_5xx_count ${snap.http5xxCount}`,
      '',
      '# HELP migration_applied_count Number of applied Prisma migrations',
      '# TYPE migration_applied_count gauge',
      `migration_applied_count ${snap.appliedMigrationCount}`,
      '',
      '# HELP migration_database_reachable 1 if database is reachable, 0 otherwise',
      '# TYPE migration_database_reachable gauge',
      `migration_database_reachable ${snap.databaseReachable ? 1 : 0}`,
    ];

    for (const [label, progress] of Object.entries(snap.backfillProgress)) {
      lines.push(
        `# HELP migration_backfill_progress Backfill completion fraction for ${label}`,
        `# TYPE migration_backfill_progress gauge`,
        `migration_backfill_progress{migration="${label}"} ${progress.toFixed(4)}`,
        '',
      );
    }

    return lines.join('\n');
  }

  // ─── Alerting Helpers ────────────────────────────────────────────────────────

  /**
   * Returns true if any key metric crosses its alert threshold.
   * Call this on a schedule (e.g. every 30 s) during live migrations and
   * send the result to the alerting service.
   */
  async shouldAlert(): Promise<{ alert: boolean; reasons: string[] }> {
    const snap = await this.getHealthSnapshot();
    const reasons: string[] = [];

    if (!snap.databaseReachable) {
      reasons.push('Database is not reachable');
    }
    if (snap.queryLatencyP99Ms > 2000) {
      reasons.push(`p99 query latency too high: ${snap.queryLatencyP99Ms}ms (threshold 2000ms)`);
    }
    if (snap.poolUtilisation > 0.8) {
      reasons.push(`Connection pool utilisation too high: ${(snap.poolUtilisation * 100).toFixed(1)}% (threshold 80%)`);
    }
    if (snap.poolTimeoutErrors > 0) {
      reasons.push(`Pool timeout errors detected: ${snap.poolTimeoutErrors}`);
    }
    if (snap.http5xxCount > 10) {
      reasons.push(`Too many HTTP 5xx errors: ${snap.http5xxCount} (threshold 10)`);
    }

    for (const [label, progress] of Object.entries(snap.backfillProgress)) {
      if (progress < 1 && progress > 0) {
        // Stalled backfill: the service would need external timestamp tracking
        // to detect this properly; we log it for awareness.
        this.logger.debug(`Backfill in progress: ${label} at ${(progress * 100).toFixed(1)}%`);
      }
    }

    return { alert: reasons.length > 0, reasons };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async isDatabaseReachable(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async countAppliedMigrations(): Promise<number> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM "_prisma_migrations"
        WHERE "finished_at" IS NOT NULL
          AND "rolled_back_at" IS NULL
      `;
      return Number(rows[0]?.count ?? 0);
    } catch {
      // Table may not exist in test environments
      return 0;
    }
  }
}
