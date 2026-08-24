import { EventIndexerService, SOROBAN_RPC_CLIENT } from './event-indexer.service';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis.service';

// Prevent @prisma/client from being loaded (generated types not available in CI)
jest.mock('../prisma.service');

/**
 * Builds an xdr-free fake event. scValToNative is bypassed by feeding the
 * service pre-native values through jest.spyOn on the SDK? — no: the real
 * scValToNative requires xdr.ScVal inputs, so instead we rely on the fact
 * that the service only calls it for topic/data entries; we pass plain JS
 * values wrapped minimally. To keep the unit test honest we mock the module.
 */
jest.mock('@stellar/stellar-sdk', () => ({
  scValToNative: jest.fn((v: unknown) => v),
}));

class RedisStub {
  private store = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> {
    return (this.store.get(key) as T) ?? null;
  }
  async set(key: string, value: unknown, _ttl: number): Promise<boolean> {
    this.store.set(key, value);
    return true;
  }
  async del(...keys: string[]): Promise<boolean> {
    keys.forEach((k) => this.store.delete(k));
    return true;
  }
}

function evt(
  ledger: number,
  action: string | null,
  data: unknown[],
  txIndex = 0,
) {
  const topic =
    action === null
      ? ['not_c_ledger', 'whatever']
      : ['c_ledger', action];
  return { ledger, txIndex, topic, data };
}

describe('EventIndexerService (#893)', () => {
  let service: EventIndexerService;
  let redisStub: RedisStub;
  let prismaMock: any;
  let rpcMock: {
    getEvents: jest.Mock;
    getLatestLedger: jest.Mock;
  };

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    redisStub = new RedisStub();

    prismaMock = {
      $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => fn(prismaMock)),
      creditBatch: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      carbonProject: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      retirementRecord: { upsert: jest.fn() },
    };

    rpcMock = {
      getEvents: jest.fn(),
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 10_000, protocolVersion: 20 }),
    };

    service = new EventIndexerService(
      rpcMock as never,
      prismaMock as PrismaService,
      redisStub as unknown as RedisService,
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

    it('advances the checkpoint to the end of a successful page', async () => {
      rpcMock.getEvents.mockResolvedValue({
        events: [evt(9_998, 'verified', ['proj-1'])],
        latestLedger: 10_000,
      });
      await service.poll();
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

    it('maps registry lifecycle actions onto project statuses', async () => {
      push(
        evt(9_992, 'reg_proj', ['proj-2']),
        evt(9_993, 'verified', ['proj-2']),
        evt(9_994, 'rejected', ['proj-3']),
        evt(9_995, 'suspended', ['proj-4']),
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
      push(evt(9_996, null, []));
      await service.poll();
      expect(prismaMock.creditBatch.upsert).not.toHaveBeenCalled();
      expect(prismaMock.carbonProject.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.carbonProject.update).not.toHaveBeenCalled();
    });
  });

  describe('SOROBAN_RPC_CLIENT token', () => {
    it('is exported for QueueModule wiring', () => {
      expect(SOROBAN_RPC_CLIENT).toBe('SOROBAN_RPC_CLIENT');
    });
  });
});
