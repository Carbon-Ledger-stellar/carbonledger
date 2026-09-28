export interface PauseStatus {
  paused: boolean;
  pausedAt?: string | null;
  pauseDurationSeconds?: number | null;
  remainingSeconds?: number | null;
}

const WARNING_THRESHOLD_SECONDS = 5 * 60;

export type PauseCountdownListener = (remainingSeconds: number) => void;
export type PauseWarningListener = () => void;
export type PauseExpiredListener = () => void;

export interface PauseCountdownOptions {
  onTick?: PauseCountdownListener;
  onWarning?: PauseWarningListener;
  onExpired?: PauseExpiredListener;
}

/**
 * Tracks the remaining time of an active pause and notifies listeners every
 * second. Emits a warning once when the 5-minute mark is reached and an
 * expiration event when the countdown hits zero.
 */
export class PauseCountdown {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private remainingSeconds = 0;
  private warningEmitted = false;
  private readonly options: PauseCountdownOptions;

  constructor(options: PauseCountdownOptions = {}) {
    this.options = options;
  }

  /**
   * Starts (or restarts) the countdown from the given pause status. If the
   * status has no duration, the countdown is cleared instead.
   */
  start(status: PauseStatus): void {
    this.stop();

    if (!status.paused) {
      return;
    }

    const remaining =
      typeof status.remainingSeconds === 'number'
        ? status.remainingSeconds
        : typeof status.pauseDurationSeconds === 'number'
        ? status.pauseDurationSeconds
        : null;

    if (remaining === null || remaining <= 0) {
      return;
    }

    this.remainingSeconds = Math.floor(remaining);
    this.warningEmitted = this.remainingSeconds <= WARNING_THRESHOLD_SECONDS;

    this.emitTick();
    if (this.warningEmitted) {
      this.emitWarning();
    }

    this.intervalId = setInterval(() => this.tick(), 1000);
  }

  /** Stops the countdown, e.g. when the admin manually unpauses. */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  getRemainingSeconds(): number {
    return this.remainingSeconds;
  }

  private tick(): void {
    this.remainingSeconds -= 1;

    if (this.remainingSeconds <= 0) {
      this.remainingSeconds = 0;
      this.emitTick();
      this.stop();
      this.options.onExpired?.();
      return;
    }

    this.emitTick();

    if (!this.warningEmitted && this.remainingSeconds <= WARNING_THRESHOLD_SECONDS) {
      this.warningEmitted = true;
      this.emitWarning();
    }
  }

  private emitTick(): void {
    this.options.onTick?.(this.remainingSeconds);
  }

  private emitWarning(): void {
    this.options.onWarning?.();
  }
}

/** Formats a remaining-seconds value as mm:ss for display in the admin UI. */
export function formatRemainingTime(remainingSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(remainingSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
