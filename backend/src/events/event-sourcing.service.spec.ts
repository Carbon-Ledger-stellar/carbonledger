import { NotFoundException } from '@nestjs/common';
import { EventSourcingService } from './event-sourcing.service';
import { CreditEventType, CreditEventRecord } from './credit-event.types';

// ── In-memory Prisma mock ──────────────────────────────────────────────────

/**
 * Lightweight in-memory store that mimics the Prisma CreditEvent & CreditProjection API.
 */
class MockPrismaService {
  private store: CreditEventRecord[] = [];
  private projectionStore: Map<string, any> = new Map();
  private idCounter = 0;

  readonly creditEvent = {
    create: async ({ data }: { data: Omit<CreditEventRecord, 'id'> }) => {
      const row: CreditEventRecord = {
        ...data,
        id: `evt-${++this.idCounter}`,
      };
      this.store.push(row);
      return row;
    },

    findMany: async ({
      where,
      orderBy,
    }: {
      where?: {
        creditBatchId?: string;
        timestamp?: { lte?: Date; gte?: Date };
      };
      orderBy?: { timestamp: 'asc' | 'desc' };
    }) => {
      let results = [...this.store];

      if (where?.creditBatchId) {
        results = results.filter((r) => r.creditBatchId === where.creditBatchId);
      }
      if (where?.timestamp?.gte) {
        results = results.filter((r) => r.timestamp >= where.timestamp!.gte!);
      }
      if (where?.timestamp?.lte) {
        results = results.filter((r) => r.timestamp <= where.timestamp!.lte!);
      }
      if (orderBy?.timestamp === 'asc') {
        results.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      } else if (orderBy?.timestamp === 'desc') {
        results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      }

      return results;
    },

    findFirst: async ({ where }: { where?: { creditBatchId?: string } }) => {
      return this.store.find((r) => r.creditBatchId === where?.creditBatchId) ?? null;
    },
  };

  readonly creditProjection = {
    findUnique: async ({ where }: any) => this.projectionStore.get(where.creditBatchId) ?? null,
    upsert: async ({ where, create, update }: any) => {
      const existing = this.projectionStore.get(where.creditBatchId);
      const data = existing ? { ...existing, ...update } : { id: `proj-${where.creditBatchId}`, ...create };
      this.projectionStore.set(where.creditBatchId, data);
      return data;
    },
  };

  /** Test helper — reset to empty state between tests. */
  _reset(): void {
    this.store = [];
    this.projectionStore.clear();
    this.idCounter = 0;
  }

  /** Test helper — access raw store for assertions. */
  _all(): CreditEventRecord[] {
    return [...this.store];
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeService(prisma?: MockPrismaService) {
  const db  = prisma ?? new MockPrismaService();
  const svc = new EventSourcingService(db as any);
  return { svc, db };
}

// ── Test suites ────────────────────────────────────────────────────────────

describe('EventSourcingService', () => {

  describe('recordEvent', () => {
    it('persists an event and returns a record with an id', async () => {
      const { svc } = makeService();
      const evt = await svc.recordEvent({
        creditBatchId: 'batch-001',
        eventType:     CreditEventType.MINT,
        actor:         'project-dev-pubkey',
        oldState:      null,
        newState:      { status: 'Active', amount: 500 },
        txHash:        'abc123',
      });

      expect(evt.id).toBeDefined();
      expect(evt.creditBatchId).toBe('batch-001');
      expect(evt.eventType).toBe('mint');
      expect(evt.actor).toBe('project-dev-pubkey');
      expect(evt.signature).toBeDefined();
      expect(evt.signature.length).toBe(64);
    });

    it('persists all six lifecycle event types', async () => {
      const { svc, db } = makeService();
      const types: CreditEventType[] = [
        CreditEventType.MINT,
        CreditEventType.VERIFY,
        CreditEventType.LIST,
        CreditEventType.DELIST,
        CreditEventType.PURCHASE,
        CreditEventType.RETIRE,
      ];
      for (const eventType of types) {
        await svc.recordEvent({
          creditBatchId: 'batch-002',
          eventType,
          actor:  'actor',
          txHash: `tx-${eventType}`,
        });
      }
      expect(db._all()).toHaveLength(types.length);
      expect(db._all().map((e) => e.eventType)).toEqual(types);
    });
  });

  describe('HMAC signing', () => {
    it('computeSignature produces a 64-char hex string', () => {
      const { svc } = makeService();
      const sig = svc.computeSignature('batch-001', 'mint', 'actor', 'txhash', new Date());
      expect(typeof sig).toBe('string');
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it('verifySignature returns true for an intact event', async () => {
      const { svc } = makeService();
      const evt = await svc.recordEvent({
        creditBatchId: 'batch-001',
        eventType:     CreditEventType.MINT,
        actor:         'actor',
        txHash:        'authentic-tx',
      });
      expect(svc.verifySignature(evt)).toBe(true);
    });

    it('verifySignature returns false for a tampered event', async () => {
      const { svc } = makeService();
      const evt = await svc.recordEvent({
        creditBatchId: 'batch-001',
        eventType:     CreditEventType.MINT,
        actor:         'actor',
        txHash:        'authentic-tx',
      });

      const tampered: CreditEventRecord = { ...evt, actor: 'attacker-key' };
      expect(svc.verifySignature(tampered)).toBe(false);
    });
  });

  describe('projection rebuild & CQRS read models', () => {
    it('rebuilds projections from event log', async () => {
      const { svc } = makeService();
      const batchId = 'batch-proj-1';

      await svc.recordEvent({
        creditBatchId: batchId,
        eventType: CreditEventType.MINT,
        actor: 'dev',
        txHash: 'tx-mint',
        newState: { projectId: 'p-100', amountAvailable: 1000, status: 'Issued' },
      });

      await svc.recordEvent({
        creditBatchId: batchId,
        eventType: CreditEventType.LIST,
        actor: 'dev',
        txHash: 'tx-list',
        newState: { status: 'Listed', pricePerCredit: '25.50' },
      });

      const rebuildResult = await svc.rebuildProjections();
      expect(rebuildResult.rebuiltBatches).toBe(1);
      expect(rebuildResult.totalEvents).toBe(2);

      const proj = await svc.getProjection(batchId);
      expect(proj).not.toBeNull();
      expect(proj?.creditBatchId).toBe(batchId);
      expect(proj?.status).toBe('Listed');
      expect(proj?.pricePerCredit).toBe('25.50');
    });

    it('reconstructs state across full 6-step lifecycle: MINT -> VERIFY -> LIST -> PURCHASE -> RETIRE', async () => {
      const { svc } = makeService();
      const batchId = 'batch-full-6';

      await svc.recordEvent({ creditBatchId: batchId, eventType: CreditEventType.MINT, actor: 'dev', txHash: 'tx1', newState: { status: 'Issued', amountAvailable: 100 } });
      await svc.recordEvent({ creditBatchId: batchId, eventType: CreditEventType.VERIFY, actor: 'verifier', txHash: 'tx2', newState: { status: 'Verified' } });
      await svc.recordEvent({ creditBatchId: batchId, eventType: CreditEventType.LIST, actor: 'dev', txHash: 'tx3', newState: { status: 'Listed', pricePerCredit: '50' } });
      await svc.recordEvent({ creditBatchId: batchId, eventType: CreditEventType.PURCHASE, actor: 'buyer', txHash: 'tx4', newState: { status: 'Sold', amountAvailable: 0, ownerPublicKey: 'buyer' } });
      await svc.recordEvent({ creditBatchId: batchId, eventType: CreditEventType.RETIRE, actor: 'buyer', txHash: 'tx5', newState: { status: 'Retired', amountRetired: 100 } });

      const finalState = await svc.reconstructState(batchId, new Date());
      expect((finalState as any).status).toBe('Retired');
      expect((finalState as any).amountRetired).toBe(100);
      expect((finalState as any).ownerPublicKey).toBe('buyer');
    });
  });

  describe('auditIntegrity', () => {
    it('detects tampered event in audit integrity check', async () => {
      const { svc, db } = makeService();
      const evt = await svc.recordEvent({
        creditBatchId: 'batch-tamper',
        eventType:     CreditEventType.MINT,
        actor:         'actor',
        txHash:        'tx-clean',
      });

      const stored = db._all().find((e) => e.id === evt.id)!;
      (stored as any).actor = 'impersonator';

      const result = await svc.auditIntegrity('batch-tamper');
      expect(result.tampered).toHaveLength(1);
      expect(result.tampered[0].id).toBe(evt.id);
    });
  });
});
