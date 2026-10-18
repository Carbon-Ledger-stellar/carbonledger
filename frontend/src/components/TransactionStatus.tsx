import { useEffect, useRef, useState } from 'react';
import { Horizon } from '@stellar/stellar-sdk';

export type TxStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'TIMEOUT';

interface TransactionStatusProps {
  hash: string;
  horizonUrl?: string;
  onStatusChange?: (status: TxStatus) => void;
}

const INITIAL_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 30000;
const BACKOFF_FACTOR = 2;
const MAX_ATTEMPTS = 30;

const isTerminal = (status: TxStatus): boolean =>
  status === 'SUCCESS' || status === 'FAILED' || status === 'TIMEOUT';

export default function TransactionStatus({
  hash,
  horizonUrl = 'https://horizon.stellar.org',
  onStatusChange,
}: TransactionStatusProps) {
  const [status, setStatus] = useState<TxStatus>('PENDING');
  const [error, setError] = useState<string | null>(null);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const onStatusChangeRef = useRef(onStatusChange);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    cancelledRef.current = false;
    setStatus('PENDING');
    setError(null);

    const server = new Horizon.Server(horizonUrl);
    let attempts = 0;
    let interval = INITIAL_INTERVAL_MS;

    const clearTimer = () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    const finish = (next: TxStatus, message?: string) => {
      clearTimer();
      if (cancelledRef.current) return;
      setStatus(next);
      if (message) setError(message);
      onStatusChangeRef.current?.(next);
    };

    const poll = async () => {
      if (cancelledRef.current) return;

      if (attempts >= MAX_ATTEMPTS) {
        finish('TIMEOUT', 'Transaction confirmation timed out');
        return;
      }
      attempts += 1;

      try {
        const tx = await server.transactions().transaction(hash).call();
        if (cancelledRef.current) return;

        if (tx.successful) {
          finish('SUCCESS');
          return;
        }
        finish('FAILED', 'Transaction failed');
        return;
      } catch (err: unknown) {
        if (cancelledRef.current) return;

        const statusCode = (err as { response?: { status?: number } })?.response
          ?.status;
        if (statusCode === 404) {
          // Not yet included in a ledger; keep polling with backoff.
          interval = Math.min(interval * BACKOFF_FACTOR, MAX_INTERVAL_MS);
          timeoutRef.current = setTimeout(poll, interval);
          return;
        }

        finish(
          'FAILED',
          err instanceof Error ? err.message : 'Failed to fetch transaction',
        );
      }
    };

    poll();

    return () => {
      cancelledRef.current = true;
      clearTimer();
    };
  }, [hash, horizonUrl]);

  return (
    <div className="transaction-status">
      <span className={`status status-${status.toLowerCase()}`}>{status}</span>
      {error && <span className="status-error">{error}</span>}
    </div>
  );
}
