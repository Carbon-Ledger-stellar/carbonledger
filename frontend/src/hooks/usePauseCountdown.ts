import { useEffect, useRef, useState } from 'react';

const WARNING_THRESHOLD_MS = 5 * 60 * 1000;

export interface PauseCountdownState {
  /** Milliseconds remaining until the pause expires. */
  remainingMs: number;
  /** Whole seconds remaining, clamped at 0. */
  remainingSeconds: number;
  /** True once the pause has expired (or no pause is active). */
  isExpired: boolean;
  /** True when 5 minutes or less remain and the pause has not expired. */
  isWarning: boolean;
}

export interface UsePauseCountdownOptions {
  /** Whether a pause is currently active. */
  isPaused: boolean;
  /**
   * Timestamp (ms since epoch) at which the pause should automatically end.
   * When null/undefined no countdown is shown.
   */
  pauseUntil?: number | null;
  /** Invoked once when the countdown reaches zero. */
  onExpire?: () => void;
  /** Warning threshold in ms. Defaults to 5 minutes. */
  warningThresholdMs?: number;
}

/**
 * Tracks the remaining time of an active pause and reports when it expires.
 *
 * - Updates every second while a pause is active.
 * - Flags a warning when the configured threshold (default 5 minutes) remains.
 * - Calls `onExpire` exactly once when the countdown reaches zero.
 * - Resets automatically when the pause is cleared (manual unpause).
 */
export function usePauseCountdown({
  isPaused,
  pauseUntil,
  onExpire,
  warningThresholdMs = WARNING_THRESHOLD_MS,
}: UsePauseCountdownOptions): PauseCountdownState {
  const computeRemaining = () =>
    pauseUntil != null ? Math.max(0, pauseUntil - Date.now()) : 0;

  const [remainingMs, setRemainingMs] = useState<number>(computeRemaining);
  const onExpireRef = useRef(onExpire);
  const hasExpiredRef = useRef(false);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (!isPaused || pauseUntil == null) {
      hasExpiredRef.current = false;
      setRemainingMs(0);
      return;
    }

    hasExpiredRef.current = false;
    setRemainingMs(computeRemaining());

    const tick = () => {
      const next = computeRemaining();
      setRemainingMs(next);

      if (next <= 0 && !hasExpiredRef.current) {
        hasExpiredRef.current = true;
        onExpireRef.current?.();
      }
    };

    tick();
    const intervalId = window.setInterval(tick, 1000);

    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPaused, pauseUntil]);

  const isExpired = !isPaused || pauseUntil == null || remainingMs <= 0;

  return {
    remainingMs,
    remainingSeconds: Math.ceil(remainingMs / 1000),
    isExpired,
    isWarning: !isExpired && remainingMs <= warningThresholdMs,
  };
}

export default usePauseCountdown;
