"use client";

/**
 * usePauseWebSocket — Issue #1256
 *
 * React hook that:
 *  - Opens a WebSocket connection to the backend realtime gateway.
 *  - Listens for CONTRACT_PAUSED / CONTRACT_UNPAUSED events.
 *  - Exposes the current pause state so consumers can react immediately
 *    instead of waiting for the next polling interval.
 *  - Auto-reconnects with exponential back-off on disconnect.
 *  - Falls back to the provided `pollingState` if the WS connection fails
 *    after `fallbackAfterAttempts` reconnection attempts.
 *
 * Usage:
 *   const { isPaused, pauseState, wsStatus } = usePauseWebSocket({
 *     contract: "marketplace",
 *     pollingState: apiPauseState,
 *   });
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { RealtimeWebSocketClient, deriveWebSocketUrl } from "./websocket";
import {
  RealtimeEventType,
  ContractPausedPayload,
  ContractUnpausedPayload,
  RealtimeEvent,
} from "./events";
import type { WebSocketConnectionStatus } from "./websocket";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PauseWebSocketState {
  isPaused: boolean;
  pausedBy?: string;
  reason?: string;
  /** Unix timestamp in ms; undefined means indefinite pause. */
  pausedUntil?: number;
  occurredAt?: string;
}

export interface UsePauseWebSocketOptions {
  /**
   * Which contract channel to watch: "marketplace" or "credit".
   * Events for other contracts are silently ignored.
   */
  contract: string;
  /**
   * Pause state from a polling source (e.g. SWR).  Used as the initial state
   * and as the fallback value if the WS connection never succeeds.
   */
  pollingState?: PauseWebSocketState | null;
  /**
   * Number of failed reconnection attempts before the hook declares the WS
   * unavailable and relies solely on `pollingState`.
   * @default 5
   */
  fallbackAfterAttempts?: number;
}

export interface UsePauseWebSocketResult {
  /** Current pause state — merged from WS events and polling fallback. */
  pauseState: PauseWebSocketState;
  /** Convenience shorthand for pauseState.isPaused. */
  isPaused: boolean;
  /** Current WebSocket connection status. */
  wsStatus: WebSocketConnectionStatus;
  /** True once the WS has failed enough times that polling is the primary source. */
  usingPollingFallback: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAUSE_CHANNEL = "pause-events";

const DEFAULT_INITIAL_STATE: PauseWebSocketState = { isPaused: false };

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePauseWebSocket({
  contract,
  pollingState,
  fallbackAfterAttempts = 5,
}: UsePauseWebSocketOptions): UsePauseWebSocketResult {
  const [wsStatus, setWsStatus] = useState<WebSocketConnectionStatus>("idle");
  const [wsState, setWsState] = useState<PauseWebSocketState | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);

  const clientRef = useRef<RealtimeWebSocketClient | null>(null);
  const contractRef = useRef(contract);
  contractRef.current = contract;

  // ── Event handler ──────────────────────────────────────────────────────────
  const handleEvent = useCallback((event: RealtimeEvent) => {
    if (event.type === RealtimeEventType.CONTRACT_PAUSED) {
      const payload = event.payload as ContractPausedPayload;
      if (payload.contract !== contractRef.current) return;
      setWsState({
        isPaused: true,
        pausedBy: payload.pausedBy,
        reason: payload.reason,
        pausedUntil: payload.pausedUntil,
        occurredAt: payload.occurredAt,
      });
    } else if (event.type === RealtimeEventType.CONTRACT_UNPAUSED) {
      const payload = event.payload as ContractUnpausedPayload;
      if (payload.contract !== contractRef.current) return;
      setWsState({
        isPaused: false,
        occurredAt: payload.occurredAt,
      });
    }
  }, []);

  // ── Status change handler ─────────────────────────────────────────────────
  const handleStatusChange = useCallback(
    (status: WebSocketConnectionStatus) => {
      setWsStatus(status);
      if (status === "disconnected") {
        setFailedAttempts((n) => n + 1);
      } else if (status === "connected") {
        setFailedAttempts(0);
      }
    },
    []
  );

  // ── Connect / disconnect lifecycle ────────────────────────────────────────
  useEffect(() => {
    // Determine WS URL
    const wsUrl =
      (typeof process !== "undefined" &&
        process.env?.NEXT_PUBLIC_WS_URL) ||
      deriveWebSocketUrl(
        typeof process !== "undefined"
          ? process.env?.NEXT_PUBLIC_API_URL
          : undefined
      );

    if (!wsUrl) {
      // No WS URL configured — fall back to polling immediately.
      setWsStatus("disconnected");
      setFailedAttempts(fallbackAfterAttempts);
      return;
    }

    const client = new RealtimeWebSocketClient({
      url: wsUrl,
      channels: [PAUSE_CHANNEL],
      onEvent: handleEvent,
      onStatusChange: handleStatusChange,
      reconnect: {
        initialDelayMs: 1_000,
        maxDelayMs: 30_000,
        multiplier: 2,
        jitter: true,
        maxAttempts: fallbackAfterAttempts,
      },
    });

    clientRef.current = client;
    client.connect();

    return () => {
      client.close();
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally stable — contract changes handled via ref.

  // ── Merge WS state with polling fallback ──────────────────────────────────
  const usingPollingFallback = failedAttempts >= fallbackAfterAttempts;

  // WS state takes precedence when available; otherwise use polling state.
  const pauseState: PauseWebSocketState =
    wsState ?? pollingState ?? DEFAULT_INITIAL_STATE;

  return {
    pauseState,
    isPaused: pauseState.isPaused,
    wsStatus,
    usingPollingFallback,
  };
}

export default usePauseWebSocket;
