import { PauseAnalyticsService, buildPeriods, renderReport, summarize } from './pause-analytics.service';
import { toQuery } from './pause-analytics.controller';
import { AnalyticsEvent } from '../analytics/analytics.constants';
import { PauseEventRecord } from './pause-analytics.types';

jest.mock('../prisma.service', () => ({ PrismaService: class PrismaService {} }));

const T0 = new Date('2026-09-01T00:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

let seq = 0;
function row(partial: Partial<PauseEventRecord> & Pick<PauseEventRecord, 'action' | 'occurredAt'>): PauseEventRecord {
  seq++;
  return {
    id: `id-${seq}`,
    contract: 'credit',
    admin: 'GADMIN',
    reason: null,
    pausedUntil: null,
    txHash: `tx-${seq}`,
    eventId: null,
    ...partial,
  };
}

/** Minimal in-memory stand-in for the prisma.pauseEvent delegate. */
function makePrisma(initial: PauseEventRecord[] = []) {
  const rows = [...initial];
  const find = (w: any) =>
    rows.find((r) => r.txHash === w.txHash_action.txHash && r.action === w.txHash_action.action) ?? null;
  return {
    rows,
    pauseEvent: {
      findUnique: jest.fn(async ({ where }: any) => find(where)),
      create: jest.fn(async ({ data }: any) => {
        const r = row({ reason: null, pausedUntil: null, eventId: null, ...data });
        rows.push(r);
        return r;
      }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(find(where)!, data)),
      findFirst: jest.fn(async ({ where }: any) =>
        rows
          .filter((r) => r.contract === where.contract && r.action === where.action && r.occurredAt <= where.occurredAt.lte)
          .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0] ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        rows
          .filter((r) => r.occurredAt >= where.occurredAt.gte && r.occurredAt <= where.occurredAt.lte)
          .filter((r) => !where.contract || r.contract === where.contract)
          .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()),
      ),
    },
  };
}

describe('PauseAnalyticsService (#1324)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let analytics: { track: jest.Mock };
  let service: PauseAnalyticsService;

  beforeEach(() => {
    prisma = makePrisma();
    analytics = { track: jest.fn() };
    service = new PauseAnalyticsService(prisma as never, analytics as never);
  });

  describe('recordOnChain', () => {
    const chainPause = {
      contract: 'credit' as const,
      action: 'pause' as const,
      admin: 'GADMIN',
      txHash: 'tx-chain',
      eventId: 'evt-1',
      occurredAt: at(0),
      pausedUntil: at(120),
    };

    it('stores a new event and tracks contract_paused with admin, reason and timestamp', async () => {
      await service.recordOnChain(chainPause);

      expect(prisma.rows).toHaveLength(1);
      expect(analytics.track).toHaveBeenCalledWith(
        'GADMIN',
        AnalyticsEvent.CONTRACT_PAUSED,
        expect.objectContaining({
          contract: 'credit',
          admin: 'GADMIN',
          reason: 'unspecified',
          occurredAt: at(0).toISOString(),
          requestedSeconds: 7200,
        }),
      );
    });

    it('is idempotent: a replay updates the row and does not re-track', async () => {
      await service.recordOnChain(chainPause);
      await service.recordOnChain(chainPause);

      expect(prisma.rows).toHaveLength(1);
      expect(analytics.track).toHaveBeenCalledTimes(1);
    });

    it('completes a row created earlier by an admin reason, keeping the reason', async () => {
      await service.recordReason(
        { contract: 'credit', action: 'pause', txHash: 'tx-chain', reason: 'oracle exploit' },
        'GADMIN',
      );
      await service.recordOnChain(chainPause);

      expect(prisma.rows).toHaveLength(1);
      expect(prisma.rows[0]).toMatchObject({
        reason: 'oracle exploit',
        eventId: 'evt-1',
        occurredAt: at(0),
        pausedUntil: at(120),
      });
      expect(analytics.track).toHaveBeenCalledTimes(1);
    });

    it('tracks the pause duration on unpause', async () => {
      await service.recordOnChain(chainPause);
      await service.recordOnChain({
        contract: 'credit', action: 'unpause', admin: 'GADMIN', txHash: 'tx-2', occurredAt: at(30),
      });

      expect(analytics.track).toHaveBeenLastCalledWith(
        'GADMIN',
        AnalyticsEvent.CONTRACT_UNPAUSED,
        expect.objectContaining({ pauseDurationSeconds: 1800 }),
      );
    });
  });

  describe('recordReason', () => {
    it('sets the reason on an already-indexed event without re-tracking', async () => {
      prisma = makePrisma([row({ action: 'pause', occurredAt: at(0), txHash: 'tx-a' })]);
      service = new PauseAnalyticsService(prisma as never, analytics as never);

      const updated = await service.recordReason(
        { contract: 'credit', action: 'pause', txHash: 'tx-a', reason: 'maintenance' },
        'GADMIN',
      );

      expect(updated.reason).toBe('maintenance');
      expect(analytics.track).not.toHaveBeenCalled();
    });
  });

  describe('exportEvents', () => {
    it('escapes CSV cells containing commas and quotes', async () => {
      prisma = makePrisma([
        row({ action: 'pause', occurredAt: at(0), reason: 'bug, "critical"', pausedUntil: at(60) }),
      ]);
      service = new PauseAnalyticsService(prisma as never, analytics as never);

      const csv = await service.exportEvents({ from: at(-1), to: at(10) }, 'csv');
      const [header, line] = csv.trim().split('\n');

      expect(header).toBe('occurredAt,contract,action,admin,reason,pausedUntil,txHash,eventId');
      expect(line).toContain('"bug, ""critical"""');
      expect(line).toContain(at(60).toISOString());
    });

    it('exports JSON', async () => {
      prisma = makePrisma([row({ action: 'pause', occurredAt: at(0) })]);
      service = new PauseAnalyticsService(prisma as never, analytics as never);

      const parsed = JSON.parse(await service.exportEvents({ from: at(-1), to: at(10) }, 'json'));
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).not.toHaveProperty('id');
    });
  });
});

describe('buildPeriods', () => {
  const now = at(1_000);

  it('ends a pause at the unpause (manual)', () => {
    const periods = buildPeriods(
      [
        row({ action: 'pause', occurredAt: at(0), pausedUntil: at(60) }),
        row({ action: 'unpause', occurredAt: at(10) }),
      ],
      now,
    );
    expect(periods).toEqual([
      expect.objectContaining({ durationSeconds: 600, requestedSeconds: 3600, endedBy: 'manual' }),
    ]);
  });

  it('caps a pause at its window when nobody unpaused (expired)', () => {
    const [p] = buildPeriods([row({ action: 'pause', occurredAt: at(0), pausedUntil: at(60) })], now);
    expect(p).toMatchObject({ durationSeconds: 3600, endedBy: 'expired', endedAt: at(60).toISOString() });
  });

  it('treats a late unpause after expiry as expired, not manual', () => {
    const [p] = buildPeriods(
      [
        row({ action: 'pause', occurredAt: at(0), pausedUntil: at(60) }),
        row({ action: 'unpause', occurredAt: at(90) }),
      ],
      now,
    );
    expect(p).toMatchObject({ durationSeconds: 3600, endedBy: 'expired' });
  });

  it('closes a pause that is replaced by a new pause (renewed)', () => {
    const periods = buildPeriods(
      [
        row({ action: 'pause', occurredAt: at(0), pausedUntil: at(60) }),
        row({ action: 'pause', occurredAt: at(30), pausedUntil: at(200) }),
      ],
      at(100),
    );
    expect(periods.map((p) => p.endedBy)).toEqual(['renewed', 'ongoing']);
    expect(periods[1].durationSeconds).toBe(70 * 60);
  });

  it('tracks each contract independently', () => {
    const periods = buildPeriods(
      [
        row({ action: 'pause', contract: 'credit', occurredAt: at(0), pausedUntil: at(60) }),
        row({ action: 'pause', contract: 'marketplace', occurredAt: at(5), pausedUntil: at(60) }),
        row({ action: 'unpause', contract: 'marketplace', occurredAt: at(15) }),
        row({ action: 'unpause', contract: 'credit', occurredAt: at(20) }),
      ],
      now,
    );
    expect(periods.map((p) => [p.contract, p.durationSeconds])).toEqual([
      ['credit', 1200],
      ['marketplace', 600],
    ]);
  });

  it('ignores an unpause with no open pause', () => {
    expect(buildPeriods([row({ action: 'unpause', occurredAt: at(0) })], now)).toEqual([]);
  });
});

describe('summarize / renderReport', () => {
  const events = [
    row({ action: 'pause', occurredAt: at(0), pausedUntil: at(60), reason: 'exploit', admin: 'GA' }),
    row({ action: 'unpause', occurredAt: at(10), admin: 'GA' }),
    row({ action: 'pause', occurredAt: at(24 * 60), pausedUntil: at(24 * 60 + 30), reason: 'exploit', admin: 'GB' }),
    row({ action: 'pause', contract: 'marketplace', occurredAt: at(24 * 60 + 5), pausedUntil: at(24 * 60 + 25), admin: 'GB' }),
  ];
  const query = { from: at(-1), to: at(3 * 24 * 60) };
  const summary = summarize(events, query, at(3 * 24 * 60));

  it('counts frequency, reasons, admins and contracts', () => {
    expect(summary.totals).toEqual({ pauses: 3, unpauses: 1 });
    expect(summary.frequency).toEqual([
      { date: '2026-09-01', pauses: 1 },
      { date: '2026-09-02', pauses: 2 },
    ]);
    expect(summary.reasons).toEqual([
      { reason: 'exploit', count: 2 },
      { reason: 'unspecified', count: 1 },
    ]);
    expect(summary.admins[0]).toEqual({ admin: 'GB', pauses: 2, unpauses: 0 });
    expect(summary.byContract).toEqual({
      credit: { pauses: 2, unpauses: 1 },
      marketplace: { pauses: 1, unpauses: 0 },
    });
  });

  it('computes duration statistics', () => {
    // 10m manual, 30m expired, 20m expired
    expect(summary.durations).toMatchObject({
      count: 3,
      meanSeconds: 1200,
      medianSeconds: 1200,
      maxSeconds: 1800,
      totalSeconds: 3600,
      byEnding: { manual: 1, expired: 2, renewed: 0, ongoing: 0 },
    });
  });

  it('renders a markdown report', () => {
    const md = renderReport(summary);
    expect(md).toContain('# Emergency Pause Analytics Report');
    expect(md).toContain('| Pauses | 3 |');
    expect(md).toContain('| Mean duration | 20m 0s |');
    expect(md).toContain('| exploit | 2 |');
  });

  it('handles an empty window', () => {
    const empty = summarize([], query, at(0));
    expect(empty.durations.meanSeconds).toBe(0);
    expect(renderReport(empty)).toContain('| Pauses | 0 |');
  });
});

describe('toQuery', () => {
  it('defaults to the last 30 days', () => {
    const now = new Date('2026-09-30T00:00:00Z');
    const q = toQuery({}, now);
    expect(q.to).toEqual(now);
    expect(q.from).toEqual(new Date('2026-08-31T00:00:00Z'));
  });

  it('rejects an inverted window', () => {
    expect(() => toQuery({ from: '2026-09-02', to: '2026-09-01' })).toThrow('`from` must be before `to`');
  });
});
