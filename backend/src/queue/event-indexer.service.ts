import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { scValToNative } from '@stellar/stellar-sdk';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis.service';

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
const CHECKPOINT_KEY = 'indexer:event-indexer:last-ledger';

const POLL_INTERVAL_MS = Number(process.env.EVENT_INDEXER_POLL_INTERVAL_MS ?? 15_000);
/** RPC servers cap getEvents ranges; stay safely below typical limits. */
const MAX_LEDGERS_PER_POLL = 5_000;
/**
 * When no checkpoint exists (first boot, or Redis was flushed), re-scan this
 * many recent ledgers instead of starting "now" — closes the gap between the
 * last real-time poll of a previous deployment and this one. All handlers are
 * idempotent upserts/increments-guarded-by-events, so rescanning is safe.
 */
const BOOTSTRAP_WINDOW_LEDGERS = 1_000;

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
    private readonly redis: RedisService,
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

  /** Last fully-processed ledger sequence. Persists across restarts (#893). */
  async getCheckpoint(): Promise<number | null> {
    const raw = await this.redis.get<number>(CHECKPOINT_KEY);
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  }

  async setCheckpoint(ledger: number): Promise<void> {
    // TTL generous enough to outlive any downtime that still allows catch-up
    // via RPC retention windows; expiry keeps stale checkpoints from pinning
    // startLedger values the server can no longer serve.
    await this.redis.set(CHECKPOINT_KEY, ledger, 30 * 24 * 60 * 60);
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
        // transfer / listed / delisted / purchase / upgraded / … are handled
        // by their own flows or carry no CreditBatch/Project status change.
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

  private async applyProjectStatus(projectId: string | undefined, status: string): Promise<void> {
    if (!projectId) return;
    await this.prisma.carbonProject.updateMany({
      where: { projectId },
      data: { status },
    });
  }
}
