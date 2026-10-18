"use client";

import { fetchPauseStatus } from "./pause-api";
import { clientLogger } from "./logger";
import type { ContractPauseStatus } from "./contract-state";

export const DEFAULT_PAUSE_SYNC_INTERVAL_MS = 15_000;

interface PauseStatusSyncOptions {
  getStatus: () => ContractPauseStatus;
  onUpdate: (status: Partial<ContractPauseStatus>) => void;
}

function debug(event: string, details: Record<string, unknown> = {}): void {
  if (process.env.NODE_ENV !== "production") {
    console.debug(`[pause-status-sync] ${event}`, details);
  }
}

/** One polling loop per provider, shared by every pause-status consumer. */
export class PauseStatusSyncService {
  private readonly subscribers = new Map<symbol, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private pending: Promise<void> | null = null;

  constructor(private readonly options: PauseStatusSyncOptions) {}

  /** The fastest active subscriber controls polling; releasing it restores the next interval. */
  subscribe(interval = DEFAULT_PAUSE_SYNC_INTERVAL_MS): () => void {
    if (typeof window === "undefined") return () => {};
    const intervalMs = Number.isFinite(interval) && interval > 0
      ? Math.min(interval, 2_147_483_647) : DEFAULT_PAUSE_SYNC_INTERVAL_MS;
    const token = Symbol("pause-status-subscriber");
    const wasIdle = this.subscribers.size === 0;
    this.subscribers.set(token, intervalMs);

    debug(wasIdle ? "started" : "subscribed", { intervalMs: this.pollingInterval() });
    if (wasIdle) {
      void this.refresh();
    } else {
      this.schedule();
    }

    return () => {
      if (!this.subscribers.delete(token)) return;
      if (this.subscribers.size === 0) {
        this.stop();
      } else {
        debug("unsubscribed", { intervalMs: this.pollingInterval() });
        this.schedule();
      }
    };
  }

  /** Refresh immediately; concurrent requests share the same in-flight promise. */
  refresh = (): Promise<void> => {
    if (this.pending) return this.pending;
    if (this.subscribers.size === 0) return Promise.resolve();
    this.clearTimer();

    const controller = new AbortController();
    this.controller = controller;
    this.pending = this.synchronize(controller).finally(() => {
      // A stopped/restarted service must not be changed by an older request.
      if (this.controller !== controller) return;
      this.controller = null;
      this.pending = null;
      this.schedule();
    });
    return this.pending;
  };

  /** Releases timers and aborts requests when the owning provider unmounts. */
  stop(): void {
    this.clearTimer();
    this.subscribers.clear();
    this.controller?.abort();
    this.controller = null;
    this.pending = null;
    debug("stopped");
  }

  private async synchronize(controller: AbortController): Promise<void> {
    debug("sync requested");
    try {
      const status = await fetchPauseStatus(controller.signal);
      if (controller.signal.aborted || this.controller !== controller) return;
      const current = this.options.getStatus();
      const changed = current.paused !== status.paused
        || current.reason !== status.reason
        || current.pausedAt !== status.pausedAt
        || current.pausedBy !== status.pausedBy
        || current.updatedAt !== status.updatedAt;
      const lastUpdated = Date.now();

      // Even an unchanged response establishes freshness and clears a previous error.
      this.options.onUpdate({
        ...(changed ? status : {}),
        lastUpdated,
        loading: false,
        error: null,
      });
      debug(changed ? "status changed" : "status unchanged", {
        previousPaused: current.paused,
        paused: status.paused,
        lastUpdated,
      });
    } catch (error: unknown) {
      if (controller.signal.aborted || this.controller !== controller) return;
      const message = error instanceof Error ? error.message : "Unable to sync pause status";
      // Preserve the last known status and successful-sync time; the next poll retries.
      this.options.onUpdate({ loading: false, error: message });
      debug("sync failed", { message });
      try {
        clientLogger.warn("Pause status sync failed", { error: message });
      } catch {
        // Logging is best-effort and must not interrupt retry scheduling.
      }
    }
  }

  private pollingInterval(): number {
    return Math.min(...this.subscribers.values());
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.clearTimer();
    // Schedule after completion, never alongside an in-flight request.
    if (this.subscribers.size === 0 || this.pending) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, this.pollingInterval());
  }
}
