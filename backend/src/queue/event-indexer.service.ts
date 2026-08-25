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

/** Singleton row id of the SyncMetadata table that stores the indexer cursor. */
const SYNC_METADATA_ID = 'singleton';

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

  // ── Polling ─────────────────────────────────────────────────────────────────

  /**
   * Poll `/getEvents` once, reconcile every `c_ledger` event into Prisma and
   * advance the checkpoint. Safe to call concurrently from tests/tools.
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

    let from: number;
    const checkpoint = await this.getCheckpoint();
    if (checkpoint !== null && checkpoint < latest) {
      from = checkpoint + 1;
    } else if (checkpoint !== null) {
      return null; // already caught up
    } else {
      from = Math.max(latest - BOOTSTRAP_WINDOW_LEDGERS, 1);
    }

    const to = Math.min(from + MAX_LEDGERS_PER_POLL - 1, latest);

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
      await this.handleEvent(event);
      processed++;
    }

    // Only advance after every event in the page succeeded — a failure keeps
    // the checkpoint where it was and the next poll replays the same window.
    await this.setCheckpoint(to);

    if (processed > 0) {
      this.logger.log(
        `Indexed ${processed} c_ledger event(s) over ledgers ${from}-${to}`,
      );
    }
    return { processed, fromLedger: from, toLedger: to };
  }

  // ── Reconciliation ──────────────────────────────────────────────────────────

  /**
   * Apply one contract event to the local database. Every branch is
   * idempotent so replaying a ledger range (restart overlap, error retry)
   * converges to the same state.
   */
  async handleEvent(event: {
    id?: string;
    topic: unknown[];
    data?: unknown;
    ledger?: number;
  }): Promise<void> {
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
        await this.applyMinted(data[0]);
        break;
      case 'retired':
        await this.applyRetired(data[0]);
        break;
      case 'transfer':
        await this.applyTransfer(data, event.id);
        break;
      case 'reg_proj':
        await this.applyProjectStatus(this.firstString(data), 'Pending');
        break;
      case 'verified':
        await this.applyProjectStatus(this.firstString(data), 'Verified');
        break;
      case 'rejected':
        await this.applyProjectStatus(this.firstString(data), 'Rejected');
        break;
      case 'st_update':
      case 'suspended':
      case 'mkt_susp':
        await this.applyProjectStatus(this.firstString(data), 'Suspended');
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
  async applyMinted(payload: unknown): Promise<void> {
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

    await this.prisma.$transaction(async (tx) => {
      await tx.creditBatch.upsert({
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
      await tx.carbonProject.update({
        where: { projectId: evt.project_id! },
        data: { totalCreditsIssued: { increment: amount }, status: 'Verified' },
      });
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
  async applyRetired(payload: unknown): Promise<void> {
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

    await this.prisma.$transaction(async (tx) => {
      await tx.carbonProject.update({
        where: { projectId: evt.project_id! },
        data: { totalCreditsRetired: { increment: amount } },
      });
      if (evt.batch_id) {
        await tx.creditBatch.updateMany({
          where: { batchId: evt.batch_id },
          data: { status: 'Retired' },
        });
      }
    });
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
  async applyTransfer(data: unknown[], eventId?: string): Promise<void> {
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
    const existing = await this.prisma.creditEvent.findFirst({
      where: { txHash, eventType: CreditEventType.TRANSFER },
    });
    if (existing) return;

    await this.prisma.creditEvent.create({
      data: {
        creditBatchId: batchId,
        eventType:     CreditEventType.TRANSFER,
        actor:         from,
        oldState:      null,
        newState:      { from, to, amount },
        txHash,
        timestamp:     new Date(),
        signature:     this.computeTransferSignature(batchId, from, txHash, new Date()),
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

  private async applyProjectStatus(projectId: string | undefined, status: string): Promise<void> {
    if (!projectId) return;
    await this.prisma.carbonProject.updateMany({
      where: { projectId },
      data: { status },
    });
  }
}

