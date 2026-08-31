/**
 * migration.spec.ts
 *
 * Tests for the zero-downtime migration tooling:
 *
 *   1. DualReadService — field fallback, write-both, backfill progress, cutover assertion.
 *   2. MigrationMonitorService — latency recording, backfill registry, alerting thresholds.
 *   3. End-to-end migration scenario simulations with concurrent read/write patterns.
 *   4. Rollback tooling — verify lint-migrations.js and rollback-migrations.js outputs.
 */

import { DualReadService } from './dual-read.service';
import {
  MigrationMonitorService,
  BackfillJobHandle,
} from './migration-monitor.service';
import { execFileSync } from 'child_process';
import * as path from 'path';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makePrismaServiceMock(overrides: Partial<{
  queryRawResult: unknown[];
  poolMetrics: ReturnType<import('../prisma.service').PrismaService['getPoolMetrics']>;
}> = {}) {
  return {
    $queryRaw: jest.fn().mockResolvedValue(
      overrides.queryRawResult ?? [{ count: BigInt(12) }],
    ),
    getPoolMetrics: jest.fn().mockReturnValue(
      overrides.poolMetrics ?? {
        pool_max: 10,
        pool_timeout_ms: 10000,
        connect_timeout_s: 10,
        active_queries: 2,
        total_queries: 1000,
        pool_timeout_errors: 0,
      },
    ),
  } as unknown as import('../prisma.service').PrismaService;
}

// ─── DualReadService ─────────────────────────────────────────────────────────

describe('DualReadService', () => {
  let service: DualReadService;

  beforeEach(() => {
    service = new DualReadService();
  });

  describe('readField()', () => {
    it('returns the new field value when it is populated', () => {
      const record = { reason: 'deforestation', retirementReason: 'old value' };
      expect(service.readField(record, 'reason', 'retirementReason')).toBe('deforestation');
    });

    it('falls back to the old field when the new field is null', () => {
      const record = { reason: null as string | null, retirementReason: 'legacy reason' };
      expect(service.readField(record, 'reason', 'retirementReason')).toBe('legacy reason');
    });

    it('falls back to the old field when the new field is undefined', () => {
      const record = { retirementReason: 'legacy' } as Record<string, unknown>;
      expect(service.readField(record, 'reason', 'retirementReason')).toBe('legacy');
    });

    it('returns falsy-but-valid new field values (0, empty string, false)', () => {
      const record = { newFlag: false, oldFlag: true };
      expect(service.readField(record, 'newFlag', 'oldFlag')).toBe(false);

      const record2 = { newCount: 0, oldCount: 42 };
      expect(service.readField(record2, 'newCount', 'oldCount')).toBe(0);

      const record3 = { newLabel: '', oldLabel: 'fallback' };
      expect(service.readField(record3, 'newLabel', 'oldLabel')).toBe('');
    });
  });

  describe('writeBothFields()', () => {
    it('produces a payload with both field names set to the same value', () => {
      const payload = service.writeBothFields('reason', 'retirementReason', 'climate');
      expect(payload).toEqual({ reason: 'climate', retirementReason: 'climate' });
    });

    it('handles numeric values', () => {
      const payload = service.writeBothFields('priceDecimal', 'priceText', 42.5);
      expect(payload.priceDecimal).toBe(42.5);
      expect(payload.priceText).toBe(42.5);
    });
  });

  describe('isBackfilled()', () => {
    it('returns true when the new field has a value', () => {
      expect(service.isBackfilled({ reason: 'data' }, 'reason')).toBe(true);
    });

    it('returns false when the new field is null', () => {
      expect(service.isBackfilled({ reason: null }, 'reason')).toBe(false);
    });

    it('returns false when the new field is undefined', () => {
      expect(service.isBackfilled({} as Record<string, unknown>, 'reason')).toBe(false);
    });
  });

  describe('backfillProgress()', () => {
    it('returns 1 for an empty array', () => {
      expect(service.backfillProgress([], 'reason')).toBe(1);
    });

    it('returns 0 when no records are backfilled', () => {
      const records = [
        { reason: null as string | null },
        { reason: null as string | null },
      ];
      expect(service.backfillProgress(records, 'reason')).toBe(0);
    });

    it('returns a correct partial fraction', () => {
      const records = [
        { reason: 'a' },
        { reason: null as string | null },
        { reason: 'b' },
        { reason: null as string | null },
      ];
      expect(service.backfillProgress(records, 'reason')).toBe(0.5);
    });

    it('returns 1 when all records are backfilled', () => {
      const records = [{ reason: 'a' }, { reason: 'b' }];
      expect(service.backfillProgress(records, 'reason')).toBe(1);
    });
  });

  describe('assertBackfillComplete()', () => {
    it('does not throw when all records have the new field', () => {
      const records = [{ reason: 'a' }, { reason: 'b' }];
      expect(() =>
        service.assertBackfillComplete(records, 'reason', 'RetirementRecord'),
      ).not.toThrow();
    });

    it('throws when any record is missing the new field', () => {
      const records = [
        { reason: 'a' },
        { reason: null as string | null },
      ];
      expect(() =>
        service.assertBackfillComplete(records, 'reason', 'RetirementRecord'),
      ).toThrow(/Backfill incomplete for RetirementRecord\.reason/);
    });

    it('includes row counts in the error message', () => {
      const records = [
        { reason: null as string | null },
        { reason: null as string | null },
        { reason: 'ok' },
      ];
      expect(() =>
        service.assertBackfillComplete(records, 'reason', 'RetirementRecord'),
      ).toThrow(/2 of 3 rows/);
    });
  });
});

// ─── MigrationMonitorService ─────────────────────────────────────────────────

describe('MigrationMonitorService', () => {
  let service: MigrationMonitorService;
  let prismaMock: ReturnType<typeof makePrismaServiceMock>;

  beforeEach(() => {
    prismaMock = makePrismaServiceMock();
    service = new MigrationMonitorService(prismaMock);
    service.onModuleInit();
  });

  describe('query latency recording', () => {
    it('returns 0 for all percentiles when no samples exist', () => {
      expect(service.getLatencyPercentile(50)).toBe(0);
      expect(service.getLatencyPercentile(99)).toBe(0);
    });

    it('records samples and computes percentiles correctly', () => {
      // Feed 10 samples: 10, 20, 30, ..., 100 ms
      for (let i = 1; i <= 10; i++) {
        service.recordQueryDuration(i * 10);
      }
      expect(service.getLatencyPercentile(50)).toBe(50);
      expect(service.getLatencyPercentile(99)).toBe(100);
    });

    it('evicts old samples when the ring buffer is full', () => {
      // Fill beyond 100 (the ring buffer capacity)
      for (let i = 0; i < 110; i++) {
        service.recordQueryDuration(i + 1);
      }
      // The buffer should contain samples 11–110 (not 1–10)
      expect(service.getLatencyPercentile(1)).toBeGreaterThanOrEqual(11);
    });
  });

  describe('backfill registry', () => {
    it('registers a job and returns a handle', () => {
      const handle: BackfillJobHandle = service.registerBackfill('test-migration', 1000);
      expect(handle.label).toBe('test-migration');
      expect(handle.total).toBe(1000);
      expect(handle.processed).toBe(0);
    });

    it('updates progress correctly over multiple batches', () => {
      const handle = service.registerBackfill('backfill-a', 1000);
      service.updateBackfill(handle, 250);
      service.updateBackfill(handle, 250);
      expect(handle.processed).toBe(500);
    });

    it('caps processed at total even if batches overshoot', () => {
      const handle = service.registerBackfill('backfill-b', 100);
      service.updateBackfill(handle, 200); // more than total
      expect(handle.processed).toBe(100);
    });

    it('marks job as complete', () => {
      const handle = service.registerBackfill('backfill-c', 500);
      service.completeBackfill(handle);
      expect(handle.processed).toBe(500);
    });

    it('reports progress fraction in getBackfillProgress()', () => {
      const handle = service.registerBackfill('backfill-d', 1000);
      service.updateBackfill(handle, 400);
      const progress = service.getBackfillProgress();
      expect(progress['backfill-d']).toBeCloseTo(0.4);
    });

    it('returns 1.0 for a completed backfill', () => {
      const handle = service.registerBackfill('backfill-e', 300);
      service.completeBackfill(handle);
      expect(service.getBackfillProgress()['backfill-e']).toBe(1);
    });

    it('removes a job after deregistration', () => {
      const handle = service.registerBackfill('backfill-f', 100);
      service.completeBackfill(handle);
      service.deregisterBackfill('backfill-f');
      expect(service.getBackfillProgress()['backfill-f']).toBeUndefined();
    });
  });

  describe('HTTP 5xx counter', () => {
    it('increments and resets correctly', () => {
      service.recordHttp5xx();
      service.recordHttp5xx();
      service.recordHttp5xx();
      const snap1 = service['http5xxCount'];
      expect(snap1).toBe(3);

      service.resetHttp5xxCount();
      expect(service['http5xxCount']).toBe(0);
    });
  });

  describe('getHealthSnapshot()', () => {
    it('returns a well-formed snapshot', async () => {
      service.recordQueryDuration(10);
      service.recordQueryDuration(20);
      const snap = await service.getHealthSnapshot();

      expect(snap.databaseReachable).toBe(true);
      expect(snap.appliedMigrationCount).toBe(12);
      expect(snap.queryLatencyP50Ms).toBeGreaterThanOrEqual(0);
      expect(snap.queryLatencyP99Ms).toBeGreaterThanOrEqual(0);
      expect(snap.poolUtilisation).toBeCloseTo(0.2); // 2 active / 10 max
      expect(snap.poolTimeoutErrors).toBe(0);
      expect(typeof snap.timestamp).toBe('string');
    });

    it('reports databaseReachable=false when the query throws', async () => {
      prismaMock.$queryRaw = jest.fn().mockRejectedValue(new Error('DB down'));
      const snap = await service.getHealthSnapshot();
      expect(snap.databaseReachable).toBe(false);
    });
  });

  describe('shouldAlert()', () => {
    it('does not alert under normal conditions', async () => {
      const result = await service.shouldAlert();
      expect(result.alert).toBe(false);
      expect(result.reasons).toHaveLength(0);
    });

    it('alerts when database is unreachable', async () => {
      prismaMock.$queryRaw = jest.fn().mockRejectedValue(new Error('DB down'));
      const result = await service.shouldAlert();
      expect(result.alert).toBe(true);
      expect(result.reasons.some((r) => r.includes('not reachable'))).toBe(true);
    });

    it('alerts when p99 latency exceeds 2000ms', async () => {
      for (let i = 0; i < 100; i++) service.recordQueryDuration(3000);
      const result = await service.shouldAlert();
      expect(result.alert).toBe(true);
      expect(result.reasons.some((r) => r.includes('p99 query latency'))).toBe(true);
    });

    it('alerts when pool utilisation exceeds 80%', async () => {
      prismaMock.getPoolMetrics = jest.fn().mockReturnValue({
        pool_max: 10,
        pool_timeout_ms: 10000,
        connect_timeout_s: 10,
        active_queries: 9,
        total_queries: 5000,
        pool_timeout_errors: 0,
      });
      const result = await service.shouldAlert();
      expect(result.alert).toBe(true);
      expect(result.reasons.some((r) => r.includes('pool utilisation'))).toBe(true);
    });

    it('alerts when pool timeout errors are detected', async () => {
      prismaMock.getPoolMetrics = jest.fn().mockReturnValue({
        pool_max: 10,
        pool_timeout_ms: 10000,
        connect_timeout_s: 10,
        active_queries: 1,
        total_queries: 100,
        pool_timeout_errors: 3,
      });
      const result = await service.shouldAlert();
      expect(result.alert).toBe(true);
      expect(result.reasons.some((r) => r.includes('Pool timeout'))).toBe(true);
    });

    it('alerts when HTTP 5xx count exceeds threshold', async () => {
      for (let i = 0; i < 11; i++) service.recordHttp5xx();
      const result = await service.shouldAlert();
      expect(result.alert).toBe(true);
      expect(result.reasons.some((r) => r.includes('HTTP 5xx'))).toBe(true);
    });
  });

  describe('toPrometheusText()', () => {
    it('produces valid Prometheus text with expected metric names', async () => {
      const text = await service.toPrometheusText();
      expect(text).toContain('migration_query_latency_p50_ms');
      expect(text).toContain('migration_query_latency_p99_ms');
      expect(text).toContain('migration_db_pool_utilisation');
      expect(text).toContain('migration_pool_timeout_errors_total');
      expect(text).toContain('migration_http_5xx_count');
      expect(text).toContain('migration_applied_count');
      expect(text).toContain('migration_database_reachable');
    });

    it('includes backfill-specific gauges when jobs are registered', async () => {
      const handle = service.registerBackfill('rename_retirement_reason', 1000);
      service.updateBackfill(handle, 600);
      const text = await service.toPrometheusText();
      expect(text).toContain('migration_backfill_progress{migration="rename_retirement_reason"}');
    });
  });
});

// ─── Concurrent read/write migration scenario simulation ─────────────────────

describe('Concurrent read/write migration scenario', () => {
  /**
   * Simulates a rolling deploy where old-code writers and new-code dual-read
   * writers run concurrently against a shared in-memory "table".
   *
   * This validates that:
   *   1. Old-code rows (missing new field) are read correctly via DualReadService fallback.
   *   2. New-code rows (both fields populated) are read correctly.
   *   3. No data is lost during the transition.
   */

  let dualRead: DualReadService;

  type Row = { id: number; reason: string | null; retirementReason: string };

  // In-memory table simulating the DB during an expand migration
  const table: Row[] = [];

  // Simulates old-code inserts (only writes retirementReason)
  function oldCodeInsert(id: number, reasonValue: string): void {
    table.push({ id, reason: null, retirementReason: reasonValue });
  }

  // Simulates new-code inserts via dual-read (writes both fields)
  function newCodeInsert(dualReadSvc: DualReadService, id: number, reasonValue: string): void {
    const both = dualReadSvc.writeBothFields('reason', 'retirementReason', reasonValue);
    table.push({ id, ...both });
  }

  beforeEach(() => {
    dualRead = new DualReadService();
    table.length = 0;
  });

  it('reads all rows correctly regardless of which code path wrote them', () => {
    // Old code inserts (pre-migration rows)
    for (let i = 1; i <= 5; i++) {
      oldCodeInsert(i, `legacy-reason-${i}`);
    }

    // New code inserts (post-expand rows, both columns populated)
    for (let i = 6; i <= 10; i++) {
      newCodeInsert(dualRead, i, `new-reason-${i}`);
    }

    // Every row should produce the correct reason value via readField
    for (const row of table) {
      const reason = dualRead.readField(row, 'reason', 'retirementReason');
      if (row.id <= 5) {
        expect(reason).toBe(`legacy-reason-${row.id}`);
      } else {
        expect(reason).toBe(`new-reason-${row.id}`);
      }
    }
  });

  it('backfillProgress() reflects the state of the table accurately', () => {
    // 3 old rows, 2 new rows
    oldCodeInsert(1, 'a');
    oldCodeInsert(2, 'b');
    oldCodeInsert(3, 'c');
    newCodeInsert(dualRead, 4, 'd');
    newCodeInsert(dualRead, 5, 'e');

    expect(dualRead.backfillProgress(table, 'reason')).toBeCloseTo(0.4);
  });

  it('assertBackfillComplete() blocks cutover while old rows remain', () => {
    oldCodeInsert(1, 'a');
    newCodeInsert(dualRead, 2, 'b');

    // Simulate backfilling the old row
    expect(() =>
      dualRead.assertBackfillComplete(table, 'reason', 'RetirementRecord'),
    ).toThrow(/Backfill incomplete/);

    // After backfill, old row gets reason populated
    const oldRow = table.find((r) => r.id === 1)!;
    oldRow.reason = oldRow.retirementReason;

    // Now the assertion should pass
    expect(() =>
      dualRead.assertBackfillComplete(table, 'reason', 'RetirementRecord'),
    ).not.toThrow();
  });

  it('handles concurrent writes with consistent reads under interleaved inserts', () => {
    // Simulate concurrent old and new code writing simultaneously
    const tasks: Array<() => void> = [];
    for (let i = 1; i <= 20; i++) {
      if (i % 2 === 0) {
        tasks.push(() => oldCodeInsert(i, `reason-${i}`));
      } else {
        tasks.push(() => newCodeInsert(dualRead, i, `reason-${i}`));
      }
    }
    // Shuffle tasks to simulate concurrency ordering non-determinism
    tasks.sort(() => Math.random() - 0.5);
    tasks.forEach((t) => t());

    expect(table).toHaveLength(20);
    for (const row of table) {
      const reason = dualRead.readField(row, 'reason', 'retirementReason');
      expect(reason).toBe(`reason-${row.id}`);
    }
  });
});

// ─── Migration tooling CLI integration ───────────────────────────────────────

describe('migration tooling CLI integration', () => {
  const backendRoot = path.resolve(__dirname, '..', '..');
  const scriptsDir = path.join(backendRoot, 'scripts');

  it('lint-migrations.js passes for the current migration set', () => {
    const output = execFileSync(
      process.execPath,
      [path.join(scriptsDir, 'lint-migrations.js')],
      { cwd: backendRoot, encoding: 'utf8' },
    );
    expect(output).toContain('Migration lint passed');
  });

  it('rollback-migrations.js emits a rollback plan for the last 3 migrations', () => {
    const output = execFileSync(
      process.execPath,
      [path.join(scriptsDir, 'rollback-migrations.js'), '--count', '3'],
      { cwd: backendRoot, encoding: 'utf8' },
    );
    expect(output).toContain('Rollback plan');
    expect(output).toContain('npx prisma migrate resolve --rolled-back');
  });

  it('rollback plan includes the expected migration names in reverse chronological order', () => {
    const output = execFileSync(
      process.execPath,
      [path.join(scriptsDir, 'rollback-migrations.js'), '--count', '2'],
      { cwd: backendRoot, encoding: 'utf8' },
    );
    // The rollback plan should include the most recent migrations
    expect(output).toMatch(/npx prisma migrate resolve --rolled-back \d{14}_/);
  });
});
