import { NotFoundException } from '@nestjs/common';
import { EventSourcingService } from './event-sourcing.service';
import { CreditEventType, CreditEventRecord } from './credit-event.types';

// ── In-memory Prisma mock ──────────────────────────────────────────────────

/**
 * Lightweight in-memory store that mimics the Prisma CreditEvent API used by
 * EventSourcingService.  Tests run without a real database.
 */
class MockPrismaService {
  private store: CreditEventRecord[] = [];
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

  /** Test helper — reset to empty state between tests. */
  _reset(): void {
    this.store = [];
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

function msAgo(ms: number): Date {
  return new Date(Date.now() - ms);
}

// ── Test suites ────────────────────────────────────────────────────────────

describe('EventSourcingService', () => {

  // ── recordEvent ──────────────────────────────────────────────────────────

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
      expect(evt.signature.length).toBe(64); // HMAC-SHA256 hex = 64 chars
    });

    it('sets a timestamp close to now', async () => {
      const { svc } = makeService();
      const before = Date.now();
      const evt = await svc.recordEvent({
        creditBatchId: 'batch-001',
        eventType:     CreditEventType.MINT,
        actor:         'actor',
        txHash:        'tx1',
      });
      const after = Date.now();

      expect(evt.timestamp.getTime()).toBeGreaterThanOrEqual(before);
      expect(evt.timestamp.getTime()).toBeLessThanOrEqual(after);
    });

    it('persists all five event types', async () => {
      const { svc, db } = makeService();
      const types: CreditEventType[] = [
        CreditEventType.MINT,
        CreditEventType.TRANSFER,
        CreditEventType.RETIRE,
        CreditEventType.LIST,
        CreditEventType.DELIST,
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

  // ── Immutability (append-only) ────────────────────────────────────────────

  describe('immutability', () => {
    it('does not expose any update or delete method', () => {
      const { svc } = makeService();
      // EventSourcingService must not have mutation methods beyond recordEvent
      expect((svc as any).updateEvent).toBeUndefined();
      expect((svc as any).deleteEvent).toBeUndefined();
    });

    it('recorded events are never modified by subsequent recordEvent calls', async () => {
      const { svc, db } = makeService();
      const first = await svc.recordEvent({
        creditBatchId: 'batch-003',
        eventType:     CreditEventType.MINT,
        actor:         'actor',
        txHash:        'tx-original',
        newState:      { status: 'Active' },
      });

      // Record a second event on the same batch
      await svc.recordEvent({
        creditBatchId: 'batch-003',
        eventType:     CreditEventType.RETIRE,
        actor:         'actor',
        txHash:        'tx-later',
        newState:      { status: 'FullyRetired' },
      });

      // First event must be unchanged
      const stored = db._all().find((e) => e.id === first.id)!;
      expect(stored.eventType).toBe('mint');
      expect(stored.txHash).toBe('tx-original');
      expect((stored.newState as any)?.status).toBe('Active');
    });

    it('stores events for different batches independently', async () => {
      const { svc, db } = makeService();
      await svc.recordEvent({
        creditBatchId: 'batch-A',
        eventType:     CreditEventType.MINT,
        actor:         'actor',
        txHash:        'tx-A',
      });
      await svc.recordEvent({
        creditBatchId: 'batch-B',
        eventType:     CreditEventType.MINT,
        actor:         'actor',
        txHash:        'tx-B',
      });

      const allEvents = db._all();
      expect(allEvents.filter((e) => e.creditBatchId === 'batch-A')).toHaveLength(1);
      expect(allEvents.filter((e) => e.creditBatchId === 'batch-B')).toHaveLength(1);
    });
  });

  // ── HMAC signing ──────────────────────────────────────────────────────────

  describe('HMAC signing', () => {
    it('computeSignature produces a 64-char hex string', () => {
      const { svc } = makeService();
      const sig = svc.computeSignature('batch-001', 'mint', 'actor', 'txhash', new Date());
      expect(typeof sig).toBe('string');
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it('same inputs produce the same signature (deterministic)', () => {
      const { svc } = makeService();
      const ts  = new Date('2025-01-01T00:00:00.000Z');
      const s1  = svc.computeSignature('batch-001', 'mint', 'actor', 'txhash', ts);
      const s2  = svc.computeSignature('batch-001', 'mint', 'actor', 'txhash', ts);
      expect(s1).toBe(s2);
    });

    it('different inputs produce different signatures', () => {
      const { svc } = makeService();
      const ts = new Date('2025-01-01T00:00:00.000Z');
      const s1 = svc.computeSignature('batch-001', 'mint',   'actor-A', 'txhash', ts);
      const s2 = svc.computeSignature('batch-001', 'retire', 'actor-A', 'txhash', ts);
      const s3 = svc.computeSignature('batch-002', 'mint',   'actor-A', 'txhash', ts);
      expect(s1).not.toBe(s2);
      expect(s1).not.toBe(s3);
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

      // Simulate tampering by mutating actor
      const tampered: CreditEventRecord = { ...evt, actor: 'attacker-key' };
      expect(svc.verifySignature(tampered)).toBe(false);
    });

    it('verifySignature returns false when txHash is altered', async () => {
      const { svc } = makeService();
      const evt = await svc.recordEvent({
        creditBatchId: 'batch-001',
        eventType:     CreditEventType.MINT,
        actor:         'actor',
        txHash:        'authentic-tx',
      });
      const tampered: CreditEventRecord = { ...evt, txHash: 'fake-tx' };
      expect(svc.verifySignature(tampered)).toBe(false);
    });
  });

  // ── getEventsForBatch ──────────────────────────────────────────────────────

  describe('getEventsForBatch', () => {
    it('returns events in chronological order', async () => {
      const { svc } = makeService();
      for (const type of [CreditEventType.MINT, CreditEventType.LIST, CreditEventType.TRANSFER]) {
        await svc.recordEvent({
          creditBatchId: 'batch-chrono',
          eventType:     type,
          actor:         'actor',
          txHash:        `tx-${type}`,
        });
      }
      const events = await svc.getEventsForBatch('batch-chrono');
      expect(events.map((e) => e.eventType)).toEqual(['mint', 'list', 'transfer']);
    });

    it('returns empty array for unknown batchId', async () => {
      const { svc } = makeService();
      const events = await svc.getEventsForBatch('nonexistent');
      expect(events).toEqual([]);
    });

    it('filters by from/to timestamps', async () => {
      const { svc, db } = makeService();

      // Manually seed events at specific times
      const t1 = new Date('2025-01-01T00:00:00Z');
      const t2 = new Date('2025-06-01T00:00:00Z');
      const t3 = new Date('2025-12-01T00:00:00Z');

      for (const [ts, type] of [[t1, CreditEventType.MINT], [t2, CreditEventType.LIST], [t3, CreditEventType.RETIRE]] as [Date, CreditEventType][]) {
        const sig = svc.computeSignature('batch-filter', type, 'actor', `tx-${type}`, ts);
        await (db.creditEvent.create as Function)({
          data: { creditBatchId: 'batch-filter', eventType: type, actor: 'actor', oldState: null, newState: null, txHash: `tx-${type}`, signature: sig, timestamp: ts },
        });
      }

      const midYear = await svc.getEventsForBatch('batch-filter', {
        from: new Date('2025-03-01Z'),
        to:   new Date('2025-09-01Z'),
      });
      expect(midYear).toHaveLength(1);
      expect(midYear[0].eventType).toBe('list');
    });
  });

  // ── reconstructState ──────────────────────────────────────────────────────

  describe('reconstructState', () => {
    it('returns the state after replaying all events up to asOf', async () => {
      const { svc } = makeService();

      await svc.recordEvent({
        creditBatchId: 'batch-rs',
        eventType:     CreditEventType.MINT,
        actor:         'actor',
        txHash:        'tx-mint',
        newState:      { status: 'Active', amount: 1000 },
      });
      await svc.recordEvent({
        creditBatchId: 'batch-rs',
        eventType:     CreditEventType.RETIRE,
        actor:         'actor',
        txHash:        'tx-retire',
        newState:      { status: 'PartiallyRetired', amount: 1000, retiredAmount: 200 },
      });

      const state = await svc.reconstructState('batch-rs', new Date());
      expect(state).not.toBeNull();
      expect((state as any).status).toBe('PartiallyRetired');
      expect((state as any).retiredAmount).toBe(200);
    });

    it('returns only minted state when asOf is before retire event', async () => {
      const { svc, db } = makeService();

      const tMint   = new Date('2025-01-01T00:00:00Z');
      const tRetire = new Date('2025-06-01T00:00:00Z');

      for (const [ts, type, newState] of [
        [tMint,   CreditEventType.MINT,   { status: 'Active', amount: 500 }],
        [tRetire, CreditEventType.RETIRE, { status: 'FullyRetired', amount: 0 }],
      ] as [Date, CreditEventType, Record<string, unknown>][]) {
        const sig = svc.computeSignature('batch-time', type, 'actor', `tx-${type}`, ts);
        await (db.creditEvent.create as Function)({
          data: { creditBatchId: 'batch-time', eventType: type, actor: 'actor', oldState: null, newState, txHash: `tx-${type}`, signature: sig, timestamp: ts },
        });
      }

      // Ask for state at Feb 2025 — before retire
      const state = await svc.reconstructState('batch-time', new Date('2025-02-01Z'));
      expect((state as any).status).toBe('Active');
      expect((state as any).amount).toBe(500);
    });

    it('returns null when asOf is before all events', async () => {
      const { svc, db } = makeService();

      const tMint = new Date('2025-06-01T00:00:00Z');
      const sig   = svc.computeSignature('batch-early', 'mint', 'actor', 'txhash', tMint);
      await (db.creditEvent.create as Function)({
        data: { creditBatchId: 'batch-early', eventType: 'mint', actor: 'actor', oldState: null, newState: { status: 'Active' }, txHash: 'txhash', signature: sig, timestamp: tMint },
      });

      // Ask for state at Jan 2025 — before the mint
      const state = await svc.reconstructState('batch-early', new Date('2025-01-01Z'));
      expect(state).toBeNull();
    });

    it('throws NotFoundException when batchId has no events at all', async () => {
      const { svc } = makeService();
      await expect(
        svc.reconstructState('batch-unknown', new Date()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('merges newState fields across multiple events', async () => {
      const { svc } = makeService();

      await svc.recordEvent({
        creditBatchId: 'batch-merge',
        eventType:     CreditEventType.MINT,
        actor:         'actor',
        txHash:        'tx1',
        newState:      { status: 'Active', amount: 1000, projectId: 'proj-1' },
      });
      await svc.recordEvent({
        creditBatchId: 'batch-merge',
        eventType:     CreditEventType.LIST,
        actor:         'actor',
        txHash:        'tx2',
        newState:      { status: 'Listed', listingId: 'lst-1' },
      });
      await svc.recordEvent({
        creditBatchId: 'batch-merge',
        eventType:     CreditEventType.TRANSFER,
        actor:         'buyer',
        txHash:        'tx3',
        newState:      { status: 'Transferred', transferredAmount: 100 },
      });

      const state = await svc.reconstructState('batch-merge', new Date());
      // Fields from all events are merged
      expect((state as any).projectId).toBe('proj-1');
      expect((state as any).listingId).toBe('lst-1');
      expect((state as any).status).toBe('Transferred');
      expect((state as any).transferredAmount).toBe(100);
    });
  });

  // ── auditIntegrity ────────────────────────────────────────────────────────

  describe('auditIntegrity', () => {
    it('returns empty tampered list for all-valid events', async () => {
      const { svc } = makeService();
      await svc.recordEvent({
        creditBatchId: 'batch-integrity',
        eventType:     CreditEventType.MINT,
        actor:         'actor',
        txHash:        'tx-clean',
      });
      const result = await svc.auditIntegrity('batch-integrity');
      expect(result.tampered).toHaveLength(0);
    });

    it('detects a tampered event', async () => {
      const { svc, db } = makeService();
      const evt = await svc.recordEvent({
        creditBatchId: 'batch-tamper',
        eventType:     CreditEventType.MINT,
        actor:         'actor',
        txHash:        'tx-clean',
      });

      // Tamper: mutate actor directly in the store
      const stored = db._all().find((e) => e.id === evt.id)!;
      (stored as any).actor = 'impersonator';

      const result = await svc.auditIntegrity('batch-tamper');
      expect(result.tampered).toHaveLength(1);
      expect(result.tampered[0].id).toBe(evt.id);
    });
  });

  // ── State reconstruction accuracy (multi-event replay) ───────────────────

  describe('state reconstruction accuracy', () => {
    it('full lifecycle: mint → list → transfer → retire', async () => {
      const { svc } = makeService();
      const batchId = 'batch-lifecycle';

      await svc.recordEvent({
        creditBatchId: batchId,
        eventType:     CreditEventType.MINT,
        actor:         'developer',
        txHash:        'tx-mint',
        newState:      { status: 'Active', amount: 100 },
      });
      await svc.recordEvent({
        creditBatchId: batchId,
        eventType:     CreditEventType.LIST,
        actor:         'developer',
        txHash:        'tx-list',
        newState:      { status: 'Listed', listingId: 'lst-abc' },
      });
      await svc.recordEvent({
        creditBatchId: batchId,
        eventType:     CreditEventType.TRANSFER,
        actor:         'corp-buyer',
        txHash:        'tx-transfer',
        newState:      { status: 'Transferred', buyer: 'corp-buyer', amount: 100 },
      });
      await svc.recordEvent({
        creditBatchId: batchId,
        eventType:     CreditEventType.RETIRE,
        actor:         'corp-buyer',
        txHash:        'tx-retire',
        newState:      { status: 'FullyRetired', retirementId: 'ret-001', beneficiary: 'ACME Corp' },
      });

      const finalState = await svc.reconstructState(batchId, new Date());
      expect((finalState as any).status).toBe('FullyRetired');
      expect((finalState as any).beneficiary).toBe('ACME Corp');
      expect((finalState as any).buyer).toBe('corp-buyer');
    });

    it('event count matches recorded events', async () => {
      const { svc } = makeService();
      const batchId = 'batch-count';
      for (let i = 0; i < 5; i++) {
        await svc.recordEvent({
          creditBatchId: batchId,
          eventType:     CreditEventType.TRANSFER,
          actor:         `buyer-${i}`,
          txHash:        `tx-${i}`,
        });
      }
      const events = await svc.getEventsForBatch(batchId);
      expect(events).toHaveLength(5);
    });
  });
});
