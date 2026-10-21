import React, { useCallback, useEffect, useRef, useState } from 'react';

const WARNING_THRESHOLD_SECONDS = 5 * 60;

interface PauseControlProps {
  /** Whether the system is currently paused. */
  isPaused: boolean;
  /** Remaining pause duration in seconds, if a duration was specified. */
  pauseDurationSeconds?: number | null;
  /** Called when the admin manually unpauses. */
  onUnpause: () => void;
  /** Called when the pause duration expires and the system should auto-unpause. */
  onAutoUnpause?: () => void;
}

function formatRemaining(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const PauseControl: React.FC<PauseControlProps> = ({
  isPaused,
  pauseDurationSeconds,
  onUnpause,
  onAutoUnpause,
}) => {
  const hasDuration =
    typeof pauseDurationSeconds === 'number' && pauseDurationSeconds > 0;

  const [remainingSeconds, setRemainingSeconds] = useState<number>(
    hasDuration ? (pauseDurationSeconds as number) : 0,
  );
  const [showWarning, setShowWarning] = useState(false);

  const onAutoUnpauseRef = useRef(onAutoUnpause);
  onAutoUnpauseRef.current = onAutoUnpause;

  // Reset the countdown whenever a new pause with a duration begins.
  useEffect(() => {
    if (isPaused && hasDuration) {
      setRemainingSeconds(pauseDurationSeconds as number);
      setShowWarning(false);
    }
  }, [isPaused, hasDuration, pauseDurationSeconds]);

  const handleAutoUnpause = useCallback(() => {
    if (onAutoUnpauseRef.current) {
      onAutoUnpauseRef.current();
    } else {
      onUnpause();
    }
  }, [onUnpause]);

  // Tick the countdown every second while paused with a duration.
  useEffect(() => {
    if (!isPaused || !hasDuration) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          window.clearInterval(intervalId);
          handleAutoUnpause();
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isPaused, hasDuration, handleAutoUnpause]);

  // Warn the admin when the pause time is running out.
  useEffect(() => {
    if (!isPaused || !hasDuration) {
      setShowWarning(false);
      return;
    }
    setShowWarning(remainingSeconds > 0 && remainingSeconds <= WARNING_THRESHOLD_SECONDS);
  }, [isPaused, hasDuration, remainingSeconds]);

  const handleManualUnpause = useCallback(() => {
    // Manual unpause cancels the running countdown.
    setRemainingSeconds(0);
    setShowWarning(false);
    onUnpause();
  }, [onUnpause]);

  if (!isPaused) {
    return null;
  }

  return (
    <div className="pause-control">
      <div className="pause-control__status">
        <span className="pause-control__label">System paused</span>
        {hasDuration && (
          <span
            className="pause-control__countdown"
            role="timer"
            aria-live="polite"
            aria-label="Remaining pause time"
          >
            {formatRemaining(remainingSeconds)}
          </span>
        )}
      </div>

      {showWarning && (
        <div className="pause-control__warning" role="alert">
          Pause time is running out — the system will unpause automatically in{' '}
          {formatRemaining(remainingSeconds)}.
        </div>
      )}

      <button
        type="button"
        className="pause-control__unpause"
        onClick={handleManualUnpause}
      >
        Unpause now
      </button>
    </div>
  );
};

export default PauseControl;
