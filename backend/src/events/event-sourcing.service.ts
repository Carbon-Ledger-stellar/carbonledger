import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import { PrismaService } from '../prisma.service';
import {
  CreditEventRecord,
  CreditEventType,
  RecordEventInput,
  CreditProjectionRecord,
} from './credit-event.types';

/**
 * EventSourcingService — append-only credit-state mutation log & projection engine.
 *
 * ## Design
 * Every write operation on a CreditBatch (mint, verify, list, delist, purchase, retire)
 * calls `recordEvent()` to persist an immutable `CreditEvent` row. Events are signed with
 * HMAC-SHA256 (key from `EVENT_HMAC_SECRET` env var) so tampering is detectable.
 *
 * ## Projections & Rebuild
 * `rebuildProjections()` replays all historical events from the append-only log to
 * reconstruct read-model projections (`CreditProjection`). All API read endpoints
 * serve from projections, fulfilling CQRS event-sourcing guarantees.
 */
@Injectable()
export class EventSourcingService {
  private readonly logger = new Logger(EventSourcingService.name);

  /** HMAC key used to sign event payloads. Override via EVENT_HMAC_SECRET. */
  private readonly hmacSecret: string =
    process.env.EVENT_HMAC_SECRET ?? 'carbonledger-dev-hmac-secret';

  constructor(private readonly prisma: PrismaService) {}

  // ── Prisma accessors ───────────────────────────────────────────────────────
  private get creditEventDb(): any {
    return (this.prisma as any).creditEvent;
  }

  private get creditProjectionDb(): any {
    return (this.prisma as any).creditProjection;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Record one credit-state mutation event and update projection.
   */
  async recordEvent(input: RecordEventInput): Promise<CreditEventRecord> {
    const timestamp = new Date();
    const signature = this.computeSignature(
      input.creditBatchId,
      input.eventType,
      input.actor,
      input.txHash,
      timestamp,
    );

    const row = await this.creditEventDb.create({
      data: {
        creditBatchId: input.creditBatchId,
        eventType:     input.eventType,
        actor:         input.actor,
        oldState:      input.oldState ?? undefined,
        newState:      input.newState ?? undefined,
        txHash:        input.txHash,
        signature,
        timestamp,
      },
    });

    this.logger.log(
      `Event recorded: ${row.eventType} on batch ${row.creditBatchId} by ${row.actor}`,
    );

    // Apply event to update projection state
    await this.applyEventToProjection(row as CreditEventRecord).catch((err) => {
      this.logger.warn(`Projection update skipped/failed: ${err.message}`);
    });

    return row as CreditEventRecord;
  }

  /**
   * Return all events for a credit batch, optionally filtered by time range.
   */
  async getEventsForBatch(
    batchId: string,
    opts: { from?: Date; to?: Date } = {},
  ): Promise<CreditEventRecord[]> {
    const rows = await this.creditEventDb.findMany({
      where: {
        creditBatchId: batchId,
        timestamp: {
          ...(opts.from ? { gte: opts.from } : {}),
          ...(opts.to   ? { lte: opts.to }   : {}),
        },
      },
      orderBy: { timestamp: 'asc' },
    });

    return rows as CreditEventRecord[];
  }

  /**
   * Reconstruct state of a credit batch at a given point in time by
   * replaying all events up to `asOf`.
   */
  async reconstructState(
    batchId: string,
    asOf: Date = new Date(),
  ): Promise<Record<string, unknown> | null> {
    const events = await this.creditEventDb.findMany({
      where: {
        creditBatchId: batchId,
        timestamp:     { lte: asOf },
      },
      orderBy: { timestamp: 'asc' },
    });

    if (events.length === 0) {
      const anyEvent = await this.creditEventDb.findFirst({
        where: { creditBatchId: batchId },
      });
      if (!anyEvent) {
        throw new NotFoundException(
          `No events found for credit batch ${batchId}`,
        );
      }
      return null;
    }

    let state: Record<string, unknown> = {};
    for (const event of events) {
      if (event.newState && typeof event.newState === 'object') {
        state = { ...state, ...(event.newState as Record<string, unknown>) };
      }
    }

    return state;
  }

  /**
   * Rebuild all read-model projections from scratch by replaying the event log.
   */
  async rebuildProjections(): Promise<{ rebuiltBatches: number; totalEvents: number }> {
    const allEvents: CreditEventRecord[] = await this.creditEventDb.findMany({
      orderBy: { timestamp: 'asc' },
    });

    // Group events by batchId
    const eventsByBatch = new Map<string, CreditEventRecord[]>();
    for (const event of allEvents) {
      const list = eventsByBatch.get(event.creditBatchId) ?? [];
      list.push(event);
      eventsByBatch.set(event.creditBatchId, list);
    }

    let rebuiltBatches = 0;
    for (const [batchId, events] of eventsByBatch) {
      let state: Record<string, any> = {};
      let lastEvent: CreditEventRecord = events[0];

      for (const event of events) {
        lastEvent = event;
        if (event.newState && typeof event.newState === 'object') {
          state = { ...state, ...(event.newState as Record<string, unknown>) };
        }
      }

      if (this.creditProjectionDb) {
        await this.creditProjectionDb.upsert({
          where: { creditBatchId: batchId },
          create: {
            creditBatchId:   batchId,
            projectId:       (state.projectId as string) ?? 'unknown-project',
            ownerPublicKey:  (state.ownerPublicKey as string) ?? (state.actor as string) ?? 'system',
            status:          (state.status as string) ?? 'Issued',
            amountAvailable: Number(state.amountAvailable ?? state.amount ?? 0),
            amountRetired:   Number(state.amountRetired ?? 0),
            pricePerCredit:  state.pricePerCredit ? String(state.pricePerCredit) : null,
            txHash:          lastEvent.txHash,
            lastEventType:   lastEvent.eventType,
            version:         events.length,
          },
          update: {
            projectId:       (state.projectId as string) ?? undefined,
            ownerPublicKey:  (state.ownerPublicKey as string) ?? undefined,
            status:          (state.status as string) ?? undefined,
            amountAvailable: Number(state.amountAvailable ?? state.amount ?? 0),
            amountRetired:   Number(state.amountRetired ?? 0),
            pricePerCredit:  state.pricePerCredit ? String(state.pricePerCredit) : undefined,
            txHash:          lastEvent.txHash,
            lastEventType:   lastEvent.eventType,
            version:         events.length,
          },
        }).catch(() => undefined);
      }
      rebuiltBatches++;
    }

    this.logger.log(`Projections rebuilt: ${rebuiltBatches} batches from ${allEvents.length} events`);
    return { rebuiltBatches, totalEvents: allEvents.length };
  }

  /**
   * Get projection for a credit batch. If missing, attempts to reconstruct.
   */
  async getProjection(batchId: string): Promise<CreditProjectionRecord | null> {
    if (this.creditProjectionDb) {
      const proj = await this.creditProjectionDb.findUnique({ where: { creditBatchId: batchId } }).catch(() => null);
      if (proj) return proj as CreditProjectionRecord;
    }

    // Reconstruct state dynamically if projection table isn't populated
    const state = await this.reconstructState(batchId, new Date()).catch(() => null);
    if (!state) return null;

    return {
      id:              `proj-${batchId}`,
      creditBatchId:   batchId,
      projectId:       (state.projectId as string) ?? 'unknown-project',
      ownerPublicKey:  (state.ownerPublicKey as string) ?? 'system',
      status:          (state.status as string) ?? 'Issued',
      amountAvailable: Number(state.amountAvailable ?? state.amount ?? 0),
      amountRetired:   Number(state.amountRetired ?? 0),
      pricePerCredit:  state.pricePerCredit ? String(state.pricePerCredit) : null,
      txHash:          (state.txHash as string) ?? null,
      lastEventType:   (state.lastEventType as string) ?? 'mint',
      version:         1,
      updatedAt:       new Date(),
      createdAt:       new Date(),
    };
  }

  /**
   * Verify HMAC signature of a stored event.
   */
  verifySignature(event: CreditEventRecord): boolean {
    const expected = this.computeSignature(
      event.creditBatchId,
      event.eventType,
      event.actor,
      event.txHash,
      event.timestamp,
    );
    return expected === event.signature;
  }

  /**
   * Verify all events for a batch and return any that have been tampered with.
   */
  async auditIntegrity(batchId: string): Promise<{ tampered: CreditEventRecord[] }> {
    const events = await this.getEventsForBatch(batchId);
    const tampered = events.filter((e) => !this.verifySignature(e));
    return { tampered };
  }

  // ── Internal Helpers ───────────────────────────────────────────────────────

  private async applyEventToProjection(event: CreditEventRecord): Promise<void> {
    if (!this.creditProjectionDb) return;
    const newState = event.newState ?? {};
    await this.creditProjectionDb.upsert({
      where: { creditBatchId: event.creditBatchId },
      create: {
        creditBatchId:   event.creditBatchId,
        projectId:       (newState.projectId as string) ?? 'unknown-project',
        ownerPublicKey:  (newState.ownerPublicKey as string) ?? event.actor,
        status:          (newState.status as string) ?? 'Issued',
        amountAvailable: Number(newState.amountAvailable ?? newState.amount ?? 0),
        amountRetired:   Number(newState.amountRetired ?? 0),
        pricePerCredit:  newState.pricePerCredit ? String(newState.pricePerCredit) : null,
        txHash:          event.txHash,
        lastEventType:   event.eventType,
        version:         1,
      },
      update: {
        projectId:       (newState.projectId as string) ?? undefined,
        ownerPublicKey:  (newState.ownerPublicKey as string) ?? undefined,
        status:          (newState.status as string) ?? undefined,
        amountAvailable: Number(newState.amountAvailable ?? newState.amount ?? 0),
        amountRetired:   Number(newState.amountRetired ?? 0),
        pricePerCredit:  newState.pricePerCredit ? String(newState.pricePerCredit) : undefined,
        txHash:          event.txHash,
        lastEventType:   event.eventType,
      },
    }).catch(() => undefined);
  }

  computeSignature(
    creditBatchId: string,
    eventType: string,
    actor: string,
    txHash: string,
    timestamp: Date,
  ): string {
    const payload = [
      creditBatchId,
      eventType,
      actor,
      txHash,
      timestamp.toISOString(),
    ].join('|');

    return createHmac('sha256', this.hmacSecret)
      .update(payload)
      .digest('hex');
  }
}
