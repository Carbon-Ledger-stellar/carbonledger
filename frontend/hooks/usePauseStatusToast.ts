"use client";

/**
 * usePauseStatusToast — shows a toast notification when any tracked contract's
 * pause status changes (#1253).
 *
 * Two integration points:
 *
 *  1. **WebSocket push** (preferred): handles CONTRACT_PAUSED /
 *     CONTRACT_UNPAUSED events delivered via RealtimeNotificationProvider.
 *     Use `handlePauseEvent(event)` to route an incoming RealtimeEvent.
 *
 *  2. **Polling fallback**: when no WebSocket connection is available the
 *     hook polls `GET /api/pause-status` every `pollIntervalMs` milliseconds
 *     and fires a toast on the first detected change.
 *
 * Toast behaviour:
 *   - Pause   → warning toast (persists until hover ends; auto-dismiss after 5 s)
 *   - Unpause → info toast (auto-dismiss after 5 s)
 *   - Hover over toast pauses the countdown.
 *   - Both toasts show the contract name and, for pauses, the reason.
 *
 * @example
 * ```tsx
 * const { handlePauseEvent } = usePauseStatusToast({ addToast });
 * // Then in your WS event handler:
 * handlePauseEvent(event);
 * ```
 */

import { useCallback, useEffect, useRef } from "react";
import type { ToastMessage } from "../components/Toast";
import type {
  RealtimeEvent,
  ContractPausedPayload,
  ContractUnpausedPayload,
} from "../lib/realtime/events";
import { RealtimeEventType } from "../lib/realtime/events";

export interface PauseStatusApi {
  /** Results returned by GET /api/pause-status */
  statuses: {
    contractName: string;
    contractId: string;
    isPaused: boolean;
    reason?: string | null;
    pausedUntil?: string | null;
  }[];
}

export interface UsePauseStatusToastOptions {
  /** Function to add a toast — provided by useToast(). */
  addToast: (toast: Omit<ToastMessage, "id">) => void;
  /**
   * Whether to enable polling fallback when no WebSocket events arrive.
   * Defaults to false — the hook is driven by WS events in production.
   */
  enablePolling?: boolean;
  /** Polling interval in milliseconds. Defaults to 30_000. */
  pollIntervalMs?: number;
  /** Override the status endpoint URL (useful in tests). */
  statusEndpoint?: string;
}

export interface UsePauseStatusToastReturn {
  /**
   * Route a RealtimeEvent to this hook. Only CONTRACT_PAUSED and
   * CONTRACT_UNPAUSED events are acted on; all others are ignored.
   */
  handlePauseEvent: (event: RealtimeEvent) => void;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_STATUS_ENDPOINT = "/api/pause-status";

/**
 * Formats a contract name for display.
 * "carbon_credit" → "Carbon Credit Contract"
 */
function formatContractName(raw: string): string {
  return raw
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") + " Contract";
}

export function usePauseStatusToast({
  addToast,
  enablePolling = false,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  statusEndpoint = DEFAULT_STATUS_ENDPOINT,
}: UsePauseStatusToastOptions): UsePauseStatusToastReturn {
  // Track the last known pause state per contractId so we only fire toasts on
  // actual transitions (not on every poll tick).
  const lastKnownPauseState = useRef<Map<string, boolean>>(new Map());

  // ── WS event handler ────────────────────────────────────────────────────

  const handlePauseEvent = useCallback(
    (event: RealtimeEvent) => {
      if (event.type === RealtimeEventType.CONTRACT_PAUSED) {
        const payload = event.payload as ContractPausedPayload;
        const name = formatContractName(payload.contract);
        const previous = lastKnownPauseState.current.get(payload.contractId);

        // Guard against duplicate events (fast pause/unpause cycles can repeat)
        if (previous === true) return;
        lastKnownPauseState.current.set(payload.contractId, true);

        const reasonLine = payload.reason
          ? ` — ${payload.reason}`
          : "";
        const expiryLine = payload.pausedUntil
          ? ` Expires: ${new Date(payload.pausedUntil).toLocaleTimeString()}.`
          : "";

        addToast({
          type: "warning",
          title: `${name} Paused`,
          message: `Transactions are temporarily suspended.${reasonLine}${expiryLine}`,
        });
        return;
      }

      if (event.type === RealtimeEventType.CONTRACT_UNPAUSED) {
        const payload = event.payload as ContractUnpausedPayload;
        const name = formatContractName(payload.contract);
        const previous = lastKnownPauseState.current.get(payload.contractId);

        if (previous === false) return;
        lastKnownPauseState.current.set(payload.contractId, false);

        addToast({
          type: "info",
          title: `${name} Resumed`,
          message: "Transactions are now available again.",
        });
      }
    },
    [addToast],
  );

  // ── Polling fallback ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!enablePolling) return;

    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(statusEndpoint);
        if (!res.ok || cancelled) return;
        const data: PauseStatusApi = await res.json();

        for (const s of data.statuses) {
          const previous = lastKnownPauseState.current.get(s.contractId);

          if (previous === undefined) {
            // First poll — seed the cache without showing a toast
            lastKnownPauseState.current.set(s.contractId, s.isPaused);
            continue;
          }

          if (previous === s.isPaused) continue; // no change

          // Status changed — synthesise a RealtimeEvent and route through
          // the same handler so toast formatting is consistent.
          const syntheticEvent: RealtimeEvent = s.isPaused
            ? {
                type: RealtimeEventType.CONTRACT_PAUSED,
                payload: {
                  contract: s.contractName,
                  contractId: s.contractId,
                  reason: s.reason,
                  pausedUntil: s.pausedUntil,
                  changedAt: new Date().toISOString(),
                } as ContractPausedPayload,
              }
            : {
                type: RealtimeEventType.CONTRACT_UNPAUSED,
                payload: {
                  contract: s.contractName,
                  contractId: s.contractId,
                  changedAt: new Date().toISOString(),
                } as ContractUnpausedPayload,
              };

          handlePauseEvent(syntheticEvent);
        }
      } catch {
        // Network errors during polling are silently ignored — the hook
        // should never cause the page to crash.
      }
    }

    // First poll immediately, then on interval
    void poll();
    const timer = setInterval(poll, pollIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enablePolling, pollIntervalMs, statusEndpoint, handlePauseEvent]);

  return { handlePauseEvent };
}
