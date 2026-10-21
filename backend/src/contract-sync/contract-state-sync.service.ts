import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma.service';

/**
 * Contracts that implement `is_paused` / `get_pause_state` on-chain.
 * Maps human-readable name → environment variable holding the contract ID.
 */
export const TRACKED_CONTRACTS = {
  carbon_credit: 'CARBON_CREDIT_CONTRACT_ID',
  carbon_marketplace: 'CARBON_MARKETPLACE_CONTRACT_ID',
} as const;

export type TrackedContractName = keyof typeof TRACKED_CONTRACTS;

export interface ContractPauseStatus {
  contractId: string;
  contractName: TrackedContractName;
  isPaused: boolean;
  reason?: string | null;
  pausedUntil?: Date | null;
}

/**
 * Fired when a contract's pause status changes (pause → unpause or the reverse).
 * Consumed by PauseAlertService and RealtimeNotificationProvider.
 */
export class PauseStatusChangedEvent {
  constructor(
    public readonly contractName: TrackedContractName,
    public readonly contractId: string,
    /** Pause status *after* the change */
    public readonly isPaused: boolean,
    public readonly reason: string | null | undefined,
    public readonly pausedUntil: Date | null | undefined,
    public readonly changedAt: Date,
  ) {}
}

/** Sync interval — 30 s keeps the cache fresh without hammering the RPC. */
const SYNC_INTERVAL_MS = 30_000;

/**
 * ContractStateSyncService — periodic poll of Soroban pause state (#1230).
 *
 * On every SYNC_INTERVAL_MS tick the service:
 *   1. Reads `AdminConfig` rows that were written by PauseService when an
 *      admin paused/unpaused a contract (keys: `<name>_paused` and
 *      `<name>_paused_until`).  This is the local authoritative source that
 *      already reflects the latest chain state, because PauseService only
 *      writes to AdminConfig *after* the contract call succeeds.
 *   2. Upserts a `ContractSyncState` row with the current values.
 *   3. If `isPaused` changed compared to the previous row, emits a
 *      `PauseStatusChangedEvent` so downstream services (alert service,
 *      WebSocket gateway) can react without polling the DB themselves.
 *
 * The service intentionally does *not* call the Soroban RPC directly —
 * PauseService already does that and owns the ground truth.  Reading from
 * `AdminConfig` keeps this service lightweight and decoupled.
 */
@Injectable()
export class ContractStateSyncService implements OnModuleInit {
  private readonly logger = new Logger(ContractStateSyncService.name);
  private isSyncing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('ContractStateSyncService initialising — running first sync');
    await this.sync().catch((err) =>
      this.logger.error('Initial contract state sync failed', err?.stack ?? err),
    );
  }

  @Interval(SYNC_INTERVAL_MS)
  async handleInterval(): Promise<void> {
    await this.sync();
  }

  /**
   * Reads pause state for all tracked contracts and updates ContractSyncState.
   * Emits a PauseStatusChangedEvent for any contract whose pause flag flips.
   */
  async sync(): Promise<void> {
    if (this.isSyncing) {
      this.logger.verbose('Sync already in progress — skipping this cycle');
      return;
    }

    this.isSyncing = true;
    const now = new Date();

    try {
      for (const [name, envVar] of Object.entries(TRACKED_CONTRACTS) as [TrackedContractName, string][]) {
        await this.syncContract(name, envVar, now);
      }
    } finally {
      this.isSyncing = false;
    }
  }

  private async syncContract(
    contractName: TrackedContractName,
    envVar: string,
    syncedAt: Date,
  ): Promise<void> {
    const contractId = process.env[envVar];
    if (!contractId) {
      this.logger.warn(
        `${envVar} is not set — skipping sync for ${contractName}`,
      );
      return;
    }

    try {
      // Read the most-recent pause state from AdminConfig.
      // PauseService writes `${contractName}_paused` and
      // `${contractName}_paused_until` after every successful contract call.
      const [pausedRow, untilRow] = await Promise.all([
        this.prisma.adminConfig.findUnique({
          where: { key: `${contractName}_paused` },
        }),
        this.prisma.adminConfig.findUnique({
          where: { key: `${contractName}_paused_until` },
        }),
      ]);

      const pausedUntilTimestamp = untilRow ? Number(untilRow.value) : 0;
      const now = Math.floor(Date.now() / 1000);

      // The pause is only effective while the timestamp is in the future.
      const isPaused =
        pausedRow?.value === 'true' && pausedUntilTimestamp > now;
      const pausedUntil =
        isPaused && pausedUntilTimestamp > 0
          ? new Date(pausedUntilTimestamp * 1000)
          : null;

      // Load the previous state so we can detect changes.
      const previous = await this.prisma.contractSyncState.findUnique({
        where: { contractId },
      });

      // Upsert the sync state row.
      await this.prisma.contractSyncState.upsert({
        where: { contractId },
        update: {
          contractName,
          isPaused,
          pausedUntil,
          lastSyncedAt: syncedAt,
          syncStatus: 'completed',
          consecutiveErrors: 0,
          lastError: null,
          lastErrorAt: null,
        },
        create: {
          contractId,
          contractName,
          isPaused,
          pausedUntil,
          lastSyncedAt: syncedAt,
          syncStatus: 'completed',
          consecutiveErrors: 0,
        },
      });

      // Emit event if pause status changed.
      const waspaused = previous?.isPaused ?? null;
      if (waspaused !== null && waspaused !== isPaused) {
        const event = new PauseStatusChangedEvent(
          contractName,
          contractId,
          isPaused,
          null, // reason not available from AdminConfig
          pausedUntil,
          syncedAt,
        );
        this.events.emit('pause.status.changed', event);
        this.logger.log(
          `Contract ${contractName} (${contractId}) pause status changed: ` +
          `${waspaused} → ${isPaused} at ${syncedAt.toISOString()}`,
        );
      }

      this.logger.verbose(
        `Synced ${contractName}: isPaused=${isPaused}`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Sync failed for ${contractName} (${contractId}): ${msg}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Increment consecutive error counter in the DB (best-effort).
      try {
        await this.prisma.contractSyncState.upsert({
          where: { contractId },
          update: {
            syncStatus: 'failed',
            lastError: msg,
            lastErrorAt: syncedAt,
            consecutiveErrors: { increment: 1 },
          },
          create: {
            contractId,
            contractName,
            isPaused: false,
            syncStatus: 'failed',
            lastError: msg,
            lastErrorAt: syncedAt,
            consecutiveErrors: 1,
          },
        });
      } catch (dbErr) {
        this.logger.error(
          `Could not persist sync error for ${contractName}: ${dbErr}`,
        );
      }
    }
  }

  /**
   * Returns the cached pause status for all tracked contracts.
   * Never makes an RPC call — reads from the local DB cache.
   */
  async getCachedPauseStatuses(): Promise<ContractPauseStatus[]> {
    const rows = await this.prisma.contractSyncState.findMany();
    return rows.map((r) => ({
      contractId: r.contractId,
      contractName: r.contractName as TrackedContractName,
      isPaused: r.isPaused,
      reason: r.pauseReason,
      pausedUntil: r.pausedUntil,
    }));
  }

  /** Returns the sync state for a single contract by name. */
  async getSyncStateForContract(
    contractName: TrackedContractName,
  ) {
    const contractId = process.env[TRACKED_CONTRACTS[contractName]];
    if (!contractId) return null;
    return this.prisma.contractSyncState.findUnique({ where: { contractId } });
  }
}
