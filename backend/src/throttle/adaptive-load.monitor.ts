import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import * as os from 'os';

/**
 * Monitors system CPU usage and exposes an `isHighLoad` flag.
 *
 * Adaptive throttling activates when CPU usage exceeds `CPU_HIGH_THRESHOLD`
 * (80%) continuously for `SUSTAINED_DURATION_MS` (5 minutes).
 *
 * Uses Node.js `os.cpus()` to sample aggregate CPU time every `POLL_INTERVAL_MS`.
 */
@Injectable()
export class AdaptiveLoadMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdaptiveLoadMonitor.name);

  /** CPU % threshold that triggers adaptive throttling. */
  static readonly CPU_HIGH_THRESHOLD = 80;

  /** Consecutive high-CPU duration before adaptive throttling activates (ms). */
  static readonly SUSTAINED_DURATION_MS = 5 * 60 * 1000; // 5 minutes

  /** How often to sample CPU usage (ms). */
  static readonly POLL_INTERVAL_MS = 15_000; // 15 seconds

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private highLoadSince: number | null = null;
  private _isHighLoad = false;

  /** True when adaptive throttling is active. */
  get isHighLoad(): boolean {
    return this._isHighLoad;
  }

  onModuleInit(): void {
    this.pollTimer = setInterval(
      () => this.sample(),
      AdaptiveLoadMonitor.POLL_INTERVAL_MS,
    );
  }

  onModuleDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Sample current CPU usage.  Returns aggregate usage % across all cores.
   * Exposed for testing (can be called directly without the poll interval).
   */
  sample(): void {
    const usage = this.currentCpuPercent();
    const now   = Date.now();

    if (usage >= AdaptiveLoadMonitor.CPU_HIGH_THRESHOLD) {
      if (this.highLoadSince === null) {
        this.highLoadSince = now;
        this.logger.warn(`CPU at ${usage.toFixed(1)}% — starting high-load timer`);
      }
      const sustained = now - this.highLoadSince;
      if (!this._isHighLoad && sustained >= AdaptiveLoadMonitor.SUSTAINED_DURATION_MS) {
        this._isHighLoad = true;
        this.logger.warn(
          `Adaptive throttling ACTIVATED — CPU >${AdaptiveLoadMonitor.CPU_HIGH_THRESHOLD}% ` +
          `for ${(sustained / 60_000).toFixed(1)} min`,
        );
      }
    } else {
      if (this._isHighLoad) {
        this._isHighLoad = false;
        this.logger.log('Adaptive throttling DEACTIVATED — CPU back to normal');
      }
      this.highLoadSince = null;
    }
  }

  /**
   * Returns current aggregate CPU usage as a percentage (0–100).
   *
   * Calculates the ratio of non-idle CPU time since the last sample using
   * os.cpus().  On the very first call it uses instantaneous idle fraction
   * (less accurate but safe).
   */
  private prevTotals: { idle: number; total: number } | null = null;

  currentCpuPercent(): number {
    const cpus = os.cpus();
    let idle  = 0;
    let total = 0;

    for (const cpu of cpus) {
      for (const [, time] of Object.entries(cpu.times)) {
        total += time;
      }
      idle += cpu.times.idle;
    }

    if (this.prevTotals) {
      const deltaIdle  = idle  - this.prevTotals.idle;
      const deltaTotal = total - this.prevTotals.total;
      this.prevTotals  = { idle, total };
      if (deltaTotal === 0) return 0;
      return 100 * (1 - deltaIdle / deltaTotal);
    }

    // First call — use instantaneous snapshot
    this.prevTotals = { idle, total };
    return total === 0 ? 0 : 100 * (1 - idle / total);
  }

  /**
   * Force-set the high-load state.  Used in tests to bypass the 5-minute
   * sustained timer.
   *
   * @internal
   */
  _forceHighLoad(value: boolean): void {
    this._isHighLoad = value;
    if (!value) this.highLoadSince = null;
  }
}
