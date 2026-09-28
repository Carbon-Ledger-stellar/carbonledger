import { useCallback, useEffect, useState } from 'react';

interface PauseStatus {
  is_paused: boolean;
  paused_at: string | null;
}

const POLL_INTERVAL_MS = 5000;

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function PauseStatusIndicator() {
  const [status, setStatus] = useState<PauseStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/pause/status');
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      const data = (await response.json()) as PauseStatus;
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load pause status');
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  if (error) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Pause status unavailable"
        className="pause-status pause-status--error"
      >
        <span className="pause-status__dot" aria-hidden="true" />
        <span className="pause-status__label">Pause status unavailable</span>
      </div>
    );
  }

  if (!status) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Loading pause status"
        className="pause-status pause-status--loading"
      >
        <span className="pause-status__dot" aria-hidden="true" />
        <span className="pause-status__label">Loading pause status…</span>
      </div>
    );
  }

  const { is_paused, paused_at } = status;
  const label = is_paused ? 'Paused' : 'Unpaused';
  const ariaLabel = is_paused
    ? `System is paused${paused_at ? ` since ${formatTimestamp(paused_at)}` : ''}`
    : 'System is unpaused';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      className={`pause-status ${is_paused ? 'pause-status--paused' : 'pause-status--unpaused'}`}
    >
      <span className="pause-status__dot" aria-hidden="true" />
      <span className="pause-status__label">{label}</span>
      {is_paused && paused_at && (
        <span className="pause-status__timestamp">
          since {formatTimestamp(paused_at)}
        </span>
      )}
    </div>
  );
}

export default PauseStatusIndicator;
