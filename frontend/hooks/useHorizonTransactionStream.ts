"use client";

import { useEffect, useRef, useCallback, useReducer } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TransactionStreamStatus =
  | "idle"
  | "submitted"
  | "pending"
  | "confirmed"
  | "failed";

export interface OptimisticUpdate {
  key: string;
  previousValue: unknown;
  optimisticValue: unknown;
}

export interface TransactionStreamState {
  status: TransactionStreamStatus;
  txHash: string | null;
  errorMessage: string | null;
  confirmedAt: string | null;
  optimisticUpdates: OptimisticUpdate[];
}

type StreamAction =
  | { type: "SUBMIT"; txHash: string }
  | { type: "CONFIRMED"; confirmedAt: string }
  | { type: "FAILED"; errorMessage: string }
  | { type: "SET_OPTIMISTIC"; updates: OptimisticUpdate[] }
  | { type: "ROLLBACK" }
  | { type: "RESET" };

function streamReducer(
  state: TransactionStreamState,
  action: StreamAction,
): TransactionStreamState {
  switch (action.type) {
    case "SUBMIT":
      return {
        ...state,
        status: "submitted",
        txHash: action.txHash,
        errorMessage: null,
        confirmedAt: null,
      };
    case "CONFIRMED":
      return {
        ...state,
        status: "confirmed",
        confirmedAt: action.confirmedAt,
        optimisticUpdates: [], // Optimistic updates are now real
      };
    case "FAILED":
      return {
        ...state,
        status: "failed",
        errorMessage: action.errorMessage,
        optimisticUpdates: [], // Rolled back in ROLLBACK action
      };
    case "SET_OPTIMISTIC":
      return {
        ...state,
        optimisticUpdates: action.updates,
      };
    case "ROLLBACK":
      return {
        ...state,
        status: "failed",
        optimisticUpdates: [], // Signal that rollback happened
      };
    case "RESET":
      return {
        status: "idle",
        txHash: null,
        errorMessage: null,
        confirmedAt: null,
        optimisticUpdates: [],
      };
    default:
      return state;
  }
}

const initialState: TransactionStreamState = {
  status: "idle",
  txHash: null,
  errorMessage: null,
  confirmedAt: null,
  optimisticUpdates: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Horizon SSE event shapes
// ─────────────────────────────────────────────────────────────────────────────

interface HorizonTxEvent {
  id: string;
  successful: boolean;
  created_at: string;
  envelope_xdr?: string;
  result_xdr?: string;
  result_codes?: {
    transaction: string;
    operations?: string[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export interface UseHorizonTransactionStreamOptions {
  /**
   * Callback fired immediately after transaction is submitted.
   * Allows callers to apply optimistic updates before confirmation.
   */
  onOptimisticUpdate?: (txHash: string) => void;
  /**
   * Callback fired when the transaction is confirmed on-chain.
   * Receives the confirmed transaction details.
   */
  onConfirmed?: (txHash: string, confirmedAt: string) => void;
  /**
   * Callback fired when a transaction fails or the stream errors.
   * Callers should roll back any optimistic state.
   */
  onRollback?: (errorMessage: string) => void;
}

export interface UseHorizonTransactionStreamReturn {
  state: TransactionStreamState;
  /**
   * Call this immediately after submitting a transaction to start
   * listening for confirmations via Horizon SSE.
   */
  startTracking: (txHash: string, optimisticUpdates?: OptimisticUpdate[]) => void;
  /**
   * Manually cancel the SSE subscription and reset state.
   */
  reset: () => void;
  /**
   * Whether optimistic state is active (submitted but not yet confirmed/failed).
   */
  isOptimistic: boolean;
}

const HORIZON_BASE_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org";

const FALLBACK_POLL_INTERVAL_MS = 5_000;
const FALLBACK_MAX_POLLS = 120; // 10 minutes

export function useHorizonTransactionStream(
  options: UseHorizonTransactionStreamOptions = {},
): UseHorizonTransactionStreamReturn {
  const { onOptimisticUpdate, onConfirmed, onRollback } = options;

  const [state, dispatch] = useReducer(streamReducer, initialState);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollCountRef = useRef(0);
  const runIdRef = useRef(0);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollCountRef.current = 0;
  }, []);

  /**
   * Fallback polling via REST for environments where SSE is unavailable
   * (e.g., service workers or non-SSE-capable browsers).
   */
  const startPollingFallback = useCallback(
    (txHash: string, runId: number) => {
      let count = 0;

      const poll = async () => {
        if (runId !== runIdRef.current) return;

        count++;
        if (count > FALLBACK_MAX_POLLS) {
          dispatch({ type: "FAILED", errorMessage: "Transaction timed out" });
          onRollback?.("Transaction confirmation timed out");
          cleanup();
          return;
        }

        try {
          const res = await fetch(
            `${HORIZON_BASE_URL}/transactions/${txHash}`,
          );

          if (res.status === 404) {
            // Not yet ingested — keep polling
            dispatch({
              type: "SUBMIT",
              txHash, // Keep as submitted / pending
            });
          } else if (res.ok) {
            const tx: HorizonTxEvent = await res.json();
            if (tx.successful) {
              dispatch({ type: "CONFIRMED", confirmedAt: tx.created_at });
              onConfirmed?.(txHash, tx.created_at);
              cleanup();
              return;
            } else {
              const msg =
                tx.result_codes?.transaction ?? "Transaction failed on-chain";
              dispatch({ type: "FAILED", errorMessage: msg });
              onRollback?.(msg);
              cleanup();
              return;
            }
          }
        } catch {
          // Network error during poll — keep going
        }

        pollTimerRef.current = setTimeout(poll, FALLBACK_POLL_INTERVAL_MS);
      };

      pollTimerRef.current = setTimeout(poll, FALLBACK_POLL_INTERVAL_MS);
    },
    [cleanup, onConfirmed, onRollback],
  );

  /**
   * Try subscribing via Horizon's SSE endpoint.
   * Falls back to polling if SSE is unavailable.
   */
  const startSSETracking = useCallback(
    (txHash: string, runId: number) => {
      try {
        // Horizon SSE for account transactions (account-level stream)
        // We use the transactions endpoint with cursor=now and filter by hash
        const sseUrl = `${HORIZON_BASE_URL}/transactions?limit=10&order=asc&cursor=now`;
        const es = new EventSource(sseUrl);
        eventSourceRef.current = es;

        es.addEventListener("message", (event) => {
          if (runId !== runIdRef.current) {
            es.close();
            return;
          }

          try {
            const tx: HorizonTxEvent = JSON.parse(event.data);

            // Only handle the tx we're watching
            if (tx.id !== txHash && !event.data.includes(txHash)) {
              return;
            }

            if (tx.successful) {
              dispatch({ type: "CONFIRMED", confirmedAt: tx.created_at });
              onConfirmed?.(txHash, tx.created_at);
              cleanup();
            } else {
              const msg =
                tx.result_codes?.transaction ?? "Transaction failed on-chain";
              dispatch({ type: "FAILED", errorMessage: msg });
              onRollback?.(msg);
              cleanup();
            }
          } catch {
            // Ignore malformed SSE messages
          }
        });

        es.addEventListener("error", () => {
          if (runId !== runIdRef.current) return;
          // SSE error — fall back to polling
          es.close();
          eventSourceRef.current = null;
          startPollingFallback(txHash, runId);
        });
      } catch {
        // EventSource not available — fall back to polling
        startPollingFallback(txHash, runId);
      }
    },
    [cleanup, onConfirmed, onRollback, startPollingFallback],
  );

  const startTracking = useCallback(
    (txHash: string, optimisticUpdates?: OptimisticUpdate[]) => {
      cleanup();

      const runId = ++runIdRef.current;
      pollCountRef.current = 0;

      dispatch({ type: "SUBMIT", txHash });

      if (optimisticUpdates && optimisticUpdates.length > 0) {
        dispatch({ type: "SET_OPTIMISTIC", updates: optimisticUpdates });
        onOptimisticUpdate?.(txHash);
      }

      // Transition to "pending" after a tick to show the submitted → pending transition
      setTimeout(() => {
        if (runId !== runIdRef.current) return;
        // Only transition to pending if we're still in submitted state
        // (confirmed/failed handlers will have fired already if very fast)
      }, 500);

      // Start SSE / polling
      startSSETracking(txHash, runId);
    },
    [cleanup, onOptimisticUpdate, startSSETracking],
  );

  const reset = useCallback(() => {
    cleanup();
    runIdRef.current++;
    dispatch({ type: "RESET" });
  }, [cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const isOptimistic =
    state.status === "submitted" || state.status === "pending";

  return { state, startTracking, reset, isOptimistic };
}
