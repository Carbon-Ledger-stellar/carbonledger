import { EventIndexerService, SOROBAN_RPC_CLIENT } from './event-indexer.service';
import { PrismaService } from '../prisma.service';

// Prevent @prisma/client from being loaded (generated types not available in CI)
jest.mock('../prisma.service');

// The service decodes topics/data via scValToNative; feeding it pre-native JS
// values through an identity mock keeps the unit test honest without XDR.
jest.mock('@stellar/stellar-sdk', () => ({
  scValToNative: jest.fn((v: unknown) => v),
}));

/** In-memory SyncMetadata singleton backing the prisma syncMetadata mock. */
let syncMeta: { id: string; lastIndexedLedger: number } | null = null;

/** In-memory ProcessedLedgerRange store backing the prisma range mock. */
type RangeRow = { id: number; startLedger: number; endLedger: number };
let rangeRows: RangeRow[] = [];
let rangeSeq = 0;

function makePrismaMock() {
  syncMeta = null;
  rangeRows = [];
  rangeSeq = 0;
  const mock: Record<string, any> = {};
  mock.$transaction = jest.fn(async (fn: (tx: any) => Promise<unknown>) => fn(mock));
  // Postgres advisory lock used for poll-window isolation (#564).
  mock.$queryRaw = jest.fn().mockResolvedValue([]);
  mock.syncMetadata = {
    findUnique: jest.fn(async () => syncMeta),
    upsert: jest.fn(
      async (args: {
        where: { id: string };
        update: { lastIndexedLedger: number };
        create: { id: string; lastIndexedLedger: number };
      }) => {
        syncMeta = {
          id: args.where.id,
          lastIndexedLedger: args.update.lastIndexedLedger ?? args.create.lastIndexedLedger,
        };
        return syncMeta;
      },
    ),
  };
  mock.processedLedgerRange = {
    findMany: jest.fn(async () => [...rangeRows].sort((a, b) => a.startLedger - b.startLedger)),
    create: jest.fn(async (args: { data: { startLedger: number; endLedger: number } }) => {
      const row: RangeRow = {
        id: ++rangeSeq,
        startLedger: args.data.startLedger,
        endLedger: args.data.endLedger,
      };
      rangeRows.push(row);
      return row;
    }),
    deleteMany: jest.fn(async (args: any) => {
      const ids = new Set(args?.where?.id?.in ?? []);
      rangeRows = rangeRows.filter((r) => !ids.has(r.id));
      return { count: 0 };
    }),
  };
  // Convenience helpers for tests to seed/read recorded ranges.
  (mock._ranges = {
    rows: () => rangeRows,
    seed: (startLedger: number, endLedger: number) => {
      const row: RangeRow = { id: ++rangeSeq, startLedger, endLedger };
      rangeRows.push(row);
    },
  }),
  mock.creditBatch = {
    upsert: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    update: jest.fn().mockResolvedValue({}),
  };
  mock.carbonProject = {
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  mock.creditEvent = {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
  };
  mock.retirementRecord = { upsert: jest.fn() };
  return mock;
}

function evt(
  ledger: number,
  action: string | null,
  data: unknown[],
  txIndex = 0,
  id?: string,
) {
  const topic =
    action === null
      ? ['not_c_ledger', 'whatever']
      : ['c_ledger', action];
  return { ledger, txIndex, topic, data, ...(id ? { id } : {}) };
}

describe('EventIndexerService (#893)', () => {
  let service: EventIndexerService;
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let rpcMock: {
    getEvents: jest.Mock;
    getLatestLedger: jest.Mock;
  };

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    prismaMock = makePrismaMock();

    rpcMock = {
      getEvents: jest.fn(),
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 10_000, protocolVersion: 20 }),
    };

    service = new EventIndexerService(
      rpcMock as never,
      prismaMock as unknown as PrismaService,
    );
  });

  describe('polling window', () => {
    it('bootstraps from (latest - BOOTSTRAP_WINDOW) when no checkpoint exists', async () => {
      rpcMock.getEvents.mockResolvedValue({ events: [], latestLedger: 10_000 });

      await service.poll();

      expect(rpcMock.getEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          startLedger: 10_000 - 1_000,
          endLedger: 10_000,
        }),
      );
    });

    it('resumes from checkpoint + 1 after a restart (#893 acceptance)', async () => {
      await service.setCheckpoint(5_500);
      rpcMock.getLatestLedger.mockResolvedValue({ sequence: 6_000, protocolVersion: 20 });
      rpcMock.getEvents.mockResolvedValue({ events: [], latestLedger: 6_000 });

      await service.poll();

      expect(rpcMock.getEvents).toHaveBeenCalledWith(
        expect.objectContaining({ startLedger: 5_501, endLedger: 6_000 }),
      );
    });

    it('is a no-op when already caught up', async () => {
      await service.setCheckpoint(10_000);
      const result = await service.poll();
      expect(result).toBeNull();
      expect(rpcMock.getEvents).not.toHaveBeenCalled();
    });

    it('persists the checkpoint in the SyncMetadata database config row (#893)', async () => {
      rpcMock.getEvents.mockResolvedValue({ events: [], latestLedger: 10_000 });

      await service.poll();

      expect(prismaMock.syncMetadata.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'singleton' },
          update: { lastIndexedLedger: 10_000 },
        }),
      );
      expect(await service.getCheckpoint()).toBe(10_000);
    });

    it('does NOT advance the checkpoint when reconciliation fails', async () => {
      prismaMock.carbonProject.updateMany.mockRejectedValueOnce(new Error('db down'));
      rpcMock.getEvents.mockResolvedValue({
        events: [evt(9_998, 'verified', ['proj-1'])],
        latestLedger: 10_000,
      });

      await expect(service.poll()).rejects.toThrow('db down');
      expect(await service.getCheckpoint()).toBeNull();
    });
  });

  describe('reconciliation', () => {
    let pendingEvents: Array<Record<string, unknown>>;

    beforeEach(() => {
      pendingEvents = [];
      rpcMock.getEvents.mockImplementation(async (req: { endLedger?: number }) => ({
        events: pendingEvents.splice(0),
        latestLedger: req.endLedger ?? 10_000,
      }));
    });

    function push(...events: Array<Record<string, unknown>>) {
      pendingEvents.push(...events);
    }

    it('reconciles minted events into CreditBatch + Project totals', async () => {
      push(
        evt(
          9_990,
          'minted',
          [
            {
              batch_id: 'batch-1',
              project_id: 'proj-1',
              amount: 500n,
              vintage_year: 2024,
              serial_start: 1n,
              serial_end: 500n,
              timestamp: 1_735_689_600n,
            },
          ],
        ),
      );

      await service.poll();

      expect(prismaMock.creditBatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { batchId: 'batch-1' },
          create: expect.objectContaining({ status: 'Active', amount: '500' }),
        }),
      );
      expect(prismaMock.carbonProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: 'proj-1' },
          data: expect.objectContaining({
            totalCreditsIssued: { increment: '500' },
          }),
        }),
      );
    });

    it('reconciles retired events into retired totals and batch status', async () => {
      push(evt(9_991, 'retired', [{ batch_id: 'batch-1', project_id: 'proj-1', amount: 100n }]));

      await service.poll();

      expect(prismaMock.carbonProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: 'proj-1' },
          data: expect.objectContaining({
            totalCreditsRetired: { increment: '100' },
          }),
        }),
      );
      expect(prismaMock.creditBatch.updateMany).toHaveBeenCalledWith({
        where: { batchId: 'batch-1' },
        data: { status: 'Retired' },
      });
    });

    it('records transfer events as append-only CreditEvent provenance rows', async () => {
      push(
        evt(9_992, 'transfer', ['batch-1', 'G-ALICE', 'G-BOB', 250n], 0, 'evt-transfer-1'),
      );

      await service.poll();

      expect(prismaMock.creditEvent.findFirst).toHaveBeenCalledWith({
        where: { txHash: 'evt-transfer-1', eventType: 'transfer' },
      });
      expect(prismaMock.creditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            creditBatchId: 'batch-1',
            eventType: 'transfer',
            actor: 'G-ALICE',
            newState: { from: 'G-ALICE', to: 'G-BOB', amount: '250' },
            txHash: 'evt-transfer-1',
            signature: expect.any(String),
          }),
        }),
      );
    });

    it('skips transfer replays that were already recorded (idempotent)', async () => {
      prismaMock.creditEvent.findFirst.mockResolvedValue({ id: 'existing' });
      push(
        evt(9_992, 'transfer', ['batch-1', 'G-ALICE', 'G-BOB', 250n], 0, 'evt-transfer-1'),
      );

      await service.poll();

      expect(prismaMock.creditEvent.create).not.toHaveBeenCalled();
    });

    it('maps registry lifecycle actions onto project statuses', async () => {
      push(
        evt(9_993, 'reg_proj', ['proj-2']),
        evt(9_994, 'verified', ['proj-2']),
        evt(9_995, 'rejected', ['proj-3']),
        evt(9_996, 'suspended', ['proj-4']),
      );

      await service.poll();

      const calls = prismaMock.carbonProject.updateMany.mock.calls.map(
        (c: any[]) => c[0],
      );
      expect(calls).toContainEqual({ where: { projectId: 'proj-2' }, data: { status: 'Pending' } });
      expect(calls).toContainEqual({ where: { projectId: 'proj-2' }, data: { status: 'Verified' } });
      expect(calls).toContainEqual({ where: { projectId: 'proj-3' }, data: { status: 'Rejected' } });
      expect(calls).toContainEqual({ where: { projectId: 'proj-4' }, data: { status: 'Suspended' } });
    });

    it('ignores events whose first topic is not c_ledger', async () => {
      push(evt(9_997, null, []));
      await service.poll();
      expect(prismaMock.creditBatch.upsert).not.toHaveBeenCalled();
      expect(prismaMock.carbonProject.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.carbonProject.update).not.toHaveBeenCalled();
      expect(prismaMock.creditEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('SOROBAN_RPC_CLIENT token', () => {
    it('is exported for QueueModule wiring', () => {
      expect(SOROBAN_RPC_CLIENT).toBe('SOROBAN_RPC_CLIENT');
    });
  });

  describe('ledger-range tracking & backfill (#564)', () => {
    beforeEach(() => {
      rpcMock.getEvents.mockImplementation(async (req: { endLedger?: number; startLedger?: number }) => ({
        events: [],
        latestLedger: req.endLedger ?? 10_000,
      }));
    });

    it('records the processed window as a ProcessedLedgerRange row', async () => {
      rpcMock.getLatestLedger.mockResolvedValue({ sequence: 10_000, protocolVersion: 20 });

      await service.poll();

      expect(prismaMock.processedLedgerRange.create).toHaveBeenCalledWith({
        data: { startLedger: 9_000, endLedger: 10_000 },
      });
    });

    it('acquires the Postgres advisory lock for transaction isolation', async () => {
      await service.poll();
      expect(prismaMock.$queryRaw).toHaveBeenCalled();
    });

    it('backfills missing sequences left by an already-processed tail (post-downtime)', async () => {
      // A previous (concurrent) poller recorded the tail; the checkpoint was
      // never advanced because of RPC downtime. The poller must detect the gap
      // [5501..7999] and backfill it before touching the covered tail.
      prismaMock._ranges.seed(8_000, 10_000);
      await service.setCheckpoint(5_500);
      rpcMock.getLatestLedger.mockResolvedValue({ sequence: 10_000, protocolVersion: 20 });

      await service.poll();

      expect(rpcMock.getEvents).toHaveBeenCalledWith(
        expect.objectContaining({ startLedger: 5_501, endLedger: 7_999 }),
      );
      // Checkpoint advances to the end of the backfilled gap.
      expect(await service.getCheckpoint()).toBe(7_999);
      // The backfilled gap [5501..7999] now touches the tail and they coalesce
      // into a single [5501..10000] range.
      const rows = prismaMock._ranges.rows();
      expect(rows.length).toBe(1);
      expect(rows[0].startLedger).toBe(5_501);
      expect(rows[0].endLedger).toBe(10_000);
    });

    it('is a no-op when every ledger up to head is already covered', async () => {
      prismaMock._ranges.seed(1, 10_000);
      const result = await service.poll();
      expect(result).toBeNull();
      expect(rpcMock.getEvents).not.toHaveBeenCalled();
    });

    it('replays window atomically under the same transaction (rollback on failure)', async () => {
      prismaMock.carbonProject.updateMany.mockRejectedValueOnce(new Error('db down'));
      rpcMock.getLatestLedger.mockResolvedValue({ sequence: 10_000, protocolVersion: 20 });
      rpcMock.getEvents.mockResolvedValue({
        events: [evt(9_500, 'verified', ['proj-1'])],
        latestLedger: 10_000,
      });

      await expect(service.poll()).rejects.toThrow('db down');
      // Neither checkpoint nor range was advanced on failure.
      expect(await service.getCheckpoint()).toBeNull();
      expect(prismaMock._ranges.rows().length).toBe(0);
    });
  });
});
