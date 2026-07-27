"use client";

/**
 * useWalletConnection
 *
 * The primary hook for managing Freighter wallet connection lifecycle.
 * Backed by walletReducer — state transitions are explicit and testable.
 *
 * Usage:
 *   const { state, connect, disconnect, retry, reset } = useWalletConnection();
 */

import { useReducer, useEffect, useCallback, useRef } from "react";
import { WatchWalletChanges } from "../lib/freighter";
import {
  INITIAL_STATE,
  walletReducer,
  performConnect,
  performDisconnect,
  performNetworkCheck,
  WalletConnectionState,
  WalletEvent,
  canConnect,
  canRetry,
} from "../lib/wallet-state-machine";

export type { WalletConnectionState };

export interface UseWalletConnectionReturn {
  state: WalletConnectionState;
  /** Initiate a connection. No-op if already connecting/connected. */
  connect: () => Promise<void>;
  /** Disconnect and reset all state. */
  disconnect: () => Promise<void>;
  /** Retry after an error, network mismatch, or account change. */
  retry: () => Promise<void>;
  /** Hard-reset to initial disconnected state (e.g. on logout). */
  reset: () => void;
  /** Re-run network check manually (e.g. after user switches network in Freighter). */
  refreshNetwork: () => Promise<void>;
}

export function useWalletConnection(): UseWalletConnectionReturn {
  const [state, dispatch] = useReducer(walletReducer, INITIAL_STATE);

  // Keep a stable reference to dispatch for use in callbacks / watchers
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const stableDispatch = useCallback((event: WalletEvent) => {
    dispatchRef.current(event);
  }, []);

  // -------------------------------------------------------------------------
  // WatchWalletChanges — react to the user switching accounts or networks
  // -------------------------------------------------------------------------
  useEffect(() => {
    // Only watch while we have an active connection
    if (state.status !== "connected") return;

    let watcher: InstanceType<typeof WatchWalletChanges> | null = null;
    try {
      watcher = new WatchWalletChanges();
      watcher.watch((data) => {
        const incomingKey = data.address ?? null;
        const incomingNetwork = (data.network as string | undefined) ?? null;

        // Account changed — invalidate
        if (incomingKey && incomingKey !== state.publicKey) {
          stableDispatch({ type: "ACCOUNT_CHANGED", publicKey: incomingKey });
        }

        // Network changed — check if it's correct
        if (incomingNetwork) {
          const isTestnet =
            incomingNetwork === "TESTNET" ||
            incomingNetwork.includes("Test SDF");
          stableDispatch({
            type: "NETWORK_CHANGED",
            network: isTestnet ? "TESTNET" : "PUBLIC",
          });
        }
      });
    } catch {
      // WatchWalletChanges may not be available in all environments — swallow
    }

    return () => {
      if (watcher && typeof (watcher as any).stop === "function") {
        (watcher as any).stop();
      }
    };
  }, [state.status, state.publicKey, stableDispatch]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const connect = useCallback(async () => {
    if (!canConnect(state.status)) return;
    await performConnect(stableDispatch);
  }, [state.status, stableDispatch]);

  const disconnect = useCallback(async () => {
    await performDisconnect(stableDispatch);
  }, [stableDispatch]);

  const retry = useCallback(async () => {
    if (!canRetry(state.status)) return;
    await performConnect(stableDispatch);
  }, [state.status, stableDispatch]);

  const reset = useCallback(() => {
    stableDispatch({ type: "RESET" });
  }, [stableDispatch]);

  const refreshNetwork = useCallback(async () => {
    await performNetworkCheck(stableDispatch);
  }, [stableDispatch]);

  return { state, connect, disconnect, retry, reset, refreshNetwork };
}
