import { useCallback, useEffect, useRef, useState } from 'react';

export interface PauseStatus {
  paused: boolean;
  reason?: string;
  pausedBy?: string;
  pausedAt?: string;
  updatedAt?: string;
}

interface UsePauseStatusOptions {
  /** Polling interval in milliseconds. Defaults to 15000. */
  intervalMs?: number;
  /** Endpoint returning the current pause status. */
  endpoint?: string;
}

const DEFAULT_ENDPOINT = '/api/pause/status';
const DEFAULT_INTERVAL_MS = 15000;

/**
 * Polls the pause status endpoint so the admin header indicator stays in sync
 * with the backend in real-time.
 */
export function usePauseStatus(options: UsePauseStatusOptions = {}) {
  const { intervalMs = DEFAULT_INTERVAL_MS, endpoint = DEFAULT_ENDPOINT } = options;

  const [status, setStatus] = useState<PauseStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });

      if (!response.ok) {
        throw new Error(`Failed to load pause status (${response.status})`);
      }

      const data = (await response.json()) as PauseStatus;
      if (!mountedRef.current) return;

      setStatus(data);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    mountedRef.current = true;
    fetchStatus();

    const timer = window.setInterval(fetchStatus, intervalMs);

    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [fetchStatus, intervalMs]);

  return { status, loading, error, refresh: fetchStatus };
}

export default usePauseStatus;
