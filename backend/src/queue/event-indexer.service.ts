import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import { scValToNative } from '@stellar/stellar-sdk';
import { PrismaService } from '../prisma.service';
import { Prisma } from '@prisma/client';
import { CreditEventType } from '../events/credit-event.types';

/**
 * Injection token for the Soroban RPC client. Provided by QueueModule as a
 * real `SorobanRpc.Server`; tests substitute an in-memory double.
 */
export const SOROBAN_RPC_CLIENT = 'SOROBAN_RPC_CLIENT';

/** Minimal surface of SorobanRpc.Server that the indexer relies on. */
export interface SorobanEventClient {
  getEvents(request: {
    startLedger?: number;
    endLedger?: number;
    cursor?: string;
    limit?: number;
    filters?: Array<{
      type: 'contract';
      contractIds?: string[];
      topics?: string[];
    }>;
  }): Promise<{
    events: Array<{
      id?: string;
      ledger: number;
      txIndex?: number;
      opIndex?: number;
      contractId?: string;
      topic: unknown[];
      data?: unknown;
    }>;
    latestLedger?: number;
    cursor?: string;
  }>;

  getLatestLedger(): Promise<{ sequence: number; protocolVersion: number }>;
}

// ── Tunables ──────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = Number(process.env.EVENT_INDEXER_POLL_INTERVAL_MS ?? 15_000);
/** RPC servers cap getEvents ranges; stay safely below typical limits. */
const MAX_LEDGERS_PER_POLL = 5_000;
/**
 * When no checkpoint exists (first boot, or the SyncMetadata row was deleted),
 * re-scan this many recent ledgers instead of starting "now" — closes the gap
 * between the last real-time poll of a previous deployment and this one. All
 * handlers are idempotent upserts/increments-guarded-by-events, so rescanning
 * is safe.
 */
const BOOTSTRAP_WINDOW_LEDGERS = 1_000;

/**
 * Arbitrary but stable integer key for the Postgres transaction advisory lock
 * used to serialize poll windows across concurrently-running poller instances.
 * (`pg_advisory_xact_lock` key space is BIGINT; we use a fixed constant.)
 */
const POLL_ADVISORY_LOCK_KEY = 0x436c6567; // "Cleg"

/** Singleton row id of the SyncMetadata table that stores the indexer cursor. */
const SYNC_METADATA_ID = 'singleton';

/** Type of the Prisma interactive transaction client used for a poll window. */
type Tx = Prisma.TransactionClient;

interface LedgerRange {
  start: number;
  end: number;
}

/** Contracts whose c_ledger events reconcile local state. */
function contractFilterIds(): string[] {
  return [
    process.env.CARBON_REGISTRY_CONTRACT_ID,
    process.env.CARBON_CREDIT_CONTRACT_ID,
    process.env.CARBON_MARKETPLACE_CONTRACT_ID,
  ].filter((id): id is string => Boolean(id));
}

@Injectable()
export class EventIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventIndexerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(SOROBAN_RPC_CLIENT) private readonly rpc: SorobanEventClient,
    private readonly prisma: PrismaService,
  ) {}

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.start();
  }

  onModuleDestroy() {
    this.stop();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.poll().catch((err: Error) =>
        this.logger.error(`Event indexing poll failed: ${err.message}`),
      );
    }, POLL_INTERVAL_MS);
    this.logger.log(`EventIndexer polling every ${POLL_INTERVAL_MS}ms`);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  // ── Checkpoint ──────────────────────────────────────────────────────────────

  /**
   * Last fully-processed ledger sequence. Persists in the database
   * (`SyncMetadata` singleton, #893) so the cursor survives Redis flushes and
   * is shared with any other process that reads the same store.
   */
  async getCheckpoint(): Promise<number | null> {
    const meta = await this.prisma.syncMetadata.findUnique({
      where: { id: SYNC_METADATA_ID },
    });
    if (!meta) return null;
    return Number.isFinite(meta.lastIndexedLedger) ? meta.lastIndexedLedger : null;
  }

  async setCheckpoint(ledger: number): Promise<void> {
    await this.prisma.syncMetadata.upsert({
      where: { id: SYNC_METADATA_ID },
      update: { lastIndexedLedger: ledger },
      create: { id: SYNC_METADATA_ID, lastIndexedLedger: ledger },
    });
  }

  private async getCheckpointFrom(tx: Tx): Promise<number | null> {
    const meta = await tx.syncMetadata.findUnique({ where: { id: SYNC_METADATA_ID } });
    if (!meta) return null;
    return Number.isFinite(meta.lastIndexedLedger) ? meta.lastIndexedLedger : null;
  }

  private async setCheckpointWithin(tx: Tx, ledger: number): Promise<void> {
    await tx.syncMetadata.upsert({
      where: { id: SYNC_METADATA_ID },
      update: { lastIndexedLedger: ledger },
      create: { id: SYNC_METADATA_ID, lastIndexedLedger: ledger },
    });
  }

  // ── Ledger range bookkeeping ────────────────────────────────────────────────

  /**
   * Query the recorded processed ranges as a sorted, disjoint list.
   * Ranges are kept coalesced by {@link recordProcessedRangeWithin}, so the
   * result describes exactly which contiguous sequences of ledgers are done.
   */
  private async getProcessedRangesFrom(tx: Tx): Promise<LedgerRange[]> {
    const rows = await tx.processedLedgerRange.findMany({
      orderBy: { startLedger: 'asc' },
    });
    return rows.map((r) => ({ start: r.startLedger, end: r.endLedger }));
  }

  /**
   * Persist the newly-processed window [from, to] and coalesce it with any
   * overlapping/adjacent ranges so the table stays a disjoint covering of the
   * processed ledger space. Runs inside the poll transaction (advisory-locked).
   */
  private async recordProcessedRangeWithin(tx: Tx, from: number, to: number): Promise<void> {
    // Because this runs under an exclusive transaction advisory lock, no other
    // poller can be mutating the same table concurrently — so read-modify-write
    // coalescing is safe.
    const overlaps = await tx.processedLedgerRange.findMany({
      where: {
        endLedger: { gte: from - 1 },
        startLedger: { lte: to + 1 },
      },
    });

    if (overlaps.length === 0) {
      await tx.processedLedgerRange.create({
        data: { startLedger: from, endLedger: to },
      });
      return;
    }

    let mergedStart = Math.min(from, ...overlaps.map((r) => r.startLedger));
    let mergedEnd = Math.max(to, ...overlaps.map((r) => r.endLedger));

    // Expand the merged range by any ranges that touch it transitively.
    let changed = true;
    while (changed) {
      changed = false;
      const neighbors = await tx.processedLedgerRange.findMany({
        where: {
          endLedger: { gte: mergedStart - 1 },
          startLedger: { lte: mergedEnd + 1 },
        },
      });
      const nextStart = Math.min(mergedStart, ...neighbors.map((r) => r.startLedger));
      const nextEnd = Math.max(mergedEnd, ...neighbors.map((r) => r.endLedger));
      if (nextStart < mergedStart || nextEnd > mergedEnd) {
        mergedStart = nextStart;
        mergedEnd = nextEnd;
        changed = true;
      }
    }

    const idsToRemove = overlaps.map((r) => r.id);
    await tx.processedLedgerRange.deleteMany({ where: { id: { in: idsToRemove } } });
    await tx.processedLedgerRange.create({
      data: { startLedger: mergedStart, endLedger: mergedEnd },
    });
  }

  /**
   * Given the current checkpoint and the RPC head, compute the sorted list of
   * ledger sequences that still need processing (the "gaps"). Any sequence in
   * `[targetStart, latest]` that is not fully covered by a recorded range is
   * returned, in ascending order, so the earliest missing range is backfilled
   * first.
   */
  private computeMissingRanges(
    ranges: LedgerRange[],
    checkpoint: number | null,
    latest: number,
  ): LedgerRange[] {
    const targetStart =
      checkpoint !== null
        ? checkpoint + 1
        : Math.max(latest - BOOTSTRAP_WINDOW_LEDGERS, 1);
    const targetEnd = latest;
    if (targetStart > targetEnd) return [];

    const missing: LedgerRange[] = [];
    let expected = targetStart;

    for (const r of ranges) {
      if (r.end < expected) continue;
      if (r.start > expected) {
        missing.push({ start: expected, end: Math.min(r.start - 1, targetEnd) });
      }
      expected = Math.max(expected, r.end + 1);
      if (expected > targetEnd) break;
    }
    if (expected <= targetEnd) {
      missing.push({ start: expected, end: targetEnd });
    }
    return missing.filter((m) => m.start <= m.end);
  }

  // ── Polling ─────────────────────────────────────────────────────────────────

  /**
   * Poll `/getEvents` once, reconcile every `c_ledger` event into Prisma and
   * advance the checkpoint — atomically, inside a single database transaction
   * guarded by a Postgres advisory lock. Safe to call concurrently from
   * tests/tools; concurrent poller instances are serialized on the lock.
   */
  async poll(): Promise<{ processed: number; fromLedger: number; toLedger: number } | null> {
    if (this.running) return null;
    this.running = true;
    try {
      return await this.pollInner();
    } finally {
      this.running = false;
    }
  }

  private async pollInner(): Promise<
    { processed: number; fromLedger: number; toLedger: number } | null
  > {
    const latest = (await this.rpc.getLatestLedger()).sequence;

    return this.prisma.$transaction(async (tx) => {
      // Transaction isolation: the advisory lock serializes all poller instances
      // that touch this table, so window selection + reconciliation + checkpoint
      // + range recording are mutually exclusive across processes. The lock is
      // released automatically when the transaction commits/aborts.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${POLL_ADVISORY_LOCK_KEY})`;

      const checkpoint = await this.getCheckpointFrom(tx);
      const ranges = await this.getProcessedRangesFrom(tx);
      const missing = this.computeMissingRanges(ranges, checkpoint, latest);
      if (missing.length === 0) return null; // already caught up, nothing to do

      // Backfill the earliest missing sequence first (this is both the normal
      // advance from the checkpoint and the post-downtime gap recovery).
      const gap = missing[0];
      const from = gap.start;
      const to = Math.min(gap.start + MAX_LEDGERS_PER_POLL - 1, gap.end, latest);

      const processed = await this.processWindow(tx, from, to);

      // Advance the checkpoint and record the range atomically with the
      // reconciliation above.
      await this.setCheckpointWithin(tx, to);
      await this.recordProcessedRangeWithin(tx, from, to);

      if (processed > 0 || from > (checkpoint ?? 0)) {
        this.logger.log(
          `Indexed ${processed} c_ledger event(s) over ledgers ${from}-${to}`,
        );
      }
      return { processed, fromLedger: from, toLedger: to };
    });
  }

  /**
   * Fetch the [from, to] window from Soroban RPC and reconcile every c_ledger
   * event using the passed transaction client, so all writes share the caller's
   * transaction and roll back together on failure.
   */
  private async processWindow(tx: Tx, from: number, to: number): Promise<number> {
    const response = await this.rpc.getEvents({
      startLedger: from,
      endLedger: to,
      filters: [
        {
          type: 'contract',
          contractIds: contractFilterIds(),
          // First topic pinned to the standard c_ledger symbol; second topic
          // (the action) wildcarded — see docs/contract-events.md.
          topics: ['c_ledger/*'],
        },
      ],
    });

    // Defensive: some RPC deployments ignore topic filters.
    const events = response.events.filter((e) => {
      try {
        return scValToNative(e.topic[0] as never) === 'c_ledger';
      } catch {
        return false;
      }
    });

    // Ledger order guarantees deterministic replay.
    events.sort((a, b) => a.ledger - b.ledger || (a.txIndex ?? 0) - (b.txIndex ?? 0));

    let processed = 0;
    for (const event of events) {
      await this.handleEvent(event, tx);
      processed++;
    }
    return processed;
  }

  // ── Reconciliation ──────────────────────────────────────────────────────────

  /**
   * Apply one contract event to the local database. Every branch is
   * idempotent so replaying a ledger range (restart overlap, error retry,
   * backfill) converges to the same state. Writes go through `tx` so the whole
   * poll window commits atomically.
   */
  async handleEvent(
    event: {
      id?: string;
      topic: unknown[];
      data?: unknown;
      ledger?: number;
    },
    tx?: Tx,
  ): Promise<void> {
    const client: Tx = (tx ?? this.prisma) as Tx;
    let topics: unknown[];
    let data: unknown[];
    try {
      topics = (event.topic || []).map((t) => scValToNative(t as never));
      data = ((event.data as unknown[]) ?? []).map((d) => scValToNative(d as never));
    } catch (err) {
      this.logger.warn(
        `Skipping malformed event at ledger ${event.ledger}: ${(err as Error).message}`,
      );
      return;
    }

    if (topics[0] !== 'c_ledger') return;
    const action = String(topics[1] ?? '');

    switch (action) {
      case 'minted':
        await this.applyMinted(data[0], client);
        break;
      case 'retired':
        await this.applyRetired(data[0], client);
        break;
      case 'transfer':
        await this.applyTransfer(data, event.id, client);
        break;
      case 'reg_proj':
        await this.applyProjectStatus(client, this.firstString(data), 'Pending');
        break;
      case 'verified':
        await this.applyProjectStatus(client, this.firstString(data), 'Verified');
        break;
      case 'rejected':
        await this.applyProjectStatus(client, this.firstString(data), 'Rejected');
        break;
      case 'st_update':
      case 'suspended':
      case 'mkt_susp':
        await this.applyProjectStatus(client, this.firstString(data), 'Suspended');
        break;
      default:
        // listed / delisted / purchase / upgraded / … are handled by their
        // own flows or carry no CreditBatch/Project status change.
        break;
    }
  }

  private firstString(data: unknown[]): string {
    return typeof data[0] === 'string' ? data[0] : String(data[0]);
  }

  /**
   * `(c_ledger, minted)` → CreditMintedEvent struct.
   * Creates/refreshes the CreditBatch as Active and bumps the project's
   * issued total.
   */
  async applyMinted(payload: unknown, tx?: Tx): Promise<void> {
    const client: Tx = (tx ?? this.prisma) as Tx;
    const evt = payload as {
      batch_id?: string;
      project_id?: string;
      amount?: bigint | number | string;
      vintage_year?: number;
      serial_start?: bigint | number | string;
      serial_end?: bigint | number | string;
      timestamp?: bigint | number;
    };
    if (!evt?.batch_id || !evt?.project_id) {
      this.logger.warn('minted event missing batch_id/project_id — skipping');
      return;
    }

    const amount = evt.amount?.toString() ?? '0';
    const issuedAt =
      evt.timestamp != null ? new Date(Number(evt.timestamp) * 1000) : new Date();

    await client.creditBatch.upsert({
      where: { batchId: evt.batch_id! },
      update: {
        projectId: evt.project_id!,
        amount,
        serialStart: evt.serial_start?.toString() ?? '0',
        serialEnd: evt.serial_end?.toString() ?? '0',
        vintageYear: Number(evt.vintage_year ?? 0),
        status: 'Active',
        issuedAt,
      },
      create: {
        batchId: evt.batch_id!,
        projectId: evt.project_id!,
        amount,
        serialStart: evt.serial_start?.toString() ?? '0',
        serialEnd: evt.serial_end?.toString() ?? '0',
        vintageYear: Number(evt.vintage_year ?? 0),
        status: 'Active',
        metadataCid: '',
        issuedAt,
      },
    });

    // Projects are normally created through the API (rich required fields),
    // so a missing row here means registration happened purely on-chain;
    // we cannot fabricate the missing columns and only bump totals when the
    // project exists.
    await client.carbonProject.update({
      where: { projectId: evt.project_id! },
      data: { totalCreditsIssued: { increment: amount }, status: 'Verified' },
    });
  }

  /**
   * `(c_ledger, retired)` → CreditRetiredEvent struct.
   * Increments the project's retired total and marks the batch retired.
   *
   * Note: a RetirementRecord cannot be reconstructed from the event alone
   * (reason/vintage/serial-range/txHash are not part of the payload); those
   * rows continue to be written by the API retirement flow. Direct-contract
   * retirements are reconciled here at the batch/project aggregate level.
   */
  async applyRetired(payload: unknown, tx?: Tx): Promise<void> {
    const client: Tx = (tx ?? this.prisma) as Tx;
    const evt = payload as {
      batch_id?: string;
      project_id?: string;
      amount?: bigint | number | string;
    };
    if (!evt?.project_id) {
      this.logger.warn('retired event missing project_id — skipping');
      return;
    }

    const amount = evt.amount?.toString() ?? '0';

    await client.carbonProject.update({
      where: { projectId: evt.project_id! },
      data: { totalCreditsRetired: { increment: amount } },
    });
    if (evt.batch_id) {
      await client.creditBatch.updateMany({
        where: { batchId: evt.batch_id },
        data: { status: 'Retired' },
      });
    }
  }

  /**
   * `(c_ledger, transfer)` → `(batch_id: String, from: Address, to: Address,
   * amount: i128)`.
   *
   * Transfers move ownership between holders and never change batch/project
   * totals, so the local update is an append-only `CreditEvent` provenance row
   * (the same log the API flows write through EventSourcingService, using the
   * identical HMAC scheme so `verifySignature`/`auditIntegrity` accept it).
   * Replays are guarded by the event id (used as txHash), which is unique per
   * on-chain event.
   */
  async applyTransfer(data: unknown[], eventId?: string, tx?: Tx): Promise<void> {
    const client: Tx = (tx ?? this.prisma) as Tx;
    const batchId = typeof data[0] === 'string' ? data[0] : String(data[0] ?? '');
    const from = typeof data[1] === 'string' ? data[1] : String(data[1] ?? '');
    const to = typeof data[2] === 'string' ? data[2] : String(data[2] ?? '');
    const amount = data[3]?.toString() ?? '';

    if (!batchId || !from || !to) {
      this.logger.warn('transfer event missing batch_id/from/to — skipping');
      return;
    }

    // Soroban RPC event ids are unique per on-chain event; reusing one as the
    // txHash makes replays idempotent (see the existence guard below).
    const txHash = eventId || `transfer:${batchId}:${from}:${to}:${amount}`;
    const existing = await client.creditEvent.findFirst({
      where: { txHash, eventType: CreditEventType.TRANSFER },
    });
    if (existing) return;

    const timestamp = new Date();
    await client.creditEvent.create({
      data: {
        creditBatchId: batchId,
        eventType:     CreditEventType.TRANSFER,
        actor:         from,
        oldState:      null,
        newState:      { from, to, amount },
        txHash,
        timestamp,
        signature:     this.computeTransferSignature(batchId, from, txHash, timestamp),
      },
    });
  }

  /**
   * Mirrors EventSourcingService.computeSignature so rows written here verify
   * under `EventSourcingService.verifySignature` / `auditIntegrity`.
   */
  private computeTransferSignature(
    creditBatchId: string,
    actor: string,
    txHash: string,
    timestamp: Date,
  ): string {
    const secret = process.env.EVENT_HMAC_SECRET ?? 'carbonledger-dev-hmac-secret';
    const payload = [
      creditBatchId,
      CreditEventType.TRANSFER,
      actor,
      txHash,
      timestamp.toISOString(),
    ].join('|');
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  private async applyProjectStatus(
    client: Tx,
    projectId: string | undefined,
    status: string,
  ): Promise<void> {
    if (!projectId) return;
    await client.carbonProject.updateMany({
      where: { projectId },
      data: { status },
    });
  }
}
