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
import { WatchWalletChanges, isFreighterConnected } from "../lib/freighter";
import {
  INITIAL_STATE,
  walletReducer,
  performConnect,
  performDisconnect,
  performNetworkCheck,
  performRestoreSession,
  performCheckExtensionAvailable,
  WalletConnectionState,
  WalletEvent,
  canConnect,
  canRetry,
} from "../lib/wallet-state-machine";
import { saveWalletSession, clearWalletSession } from "../lib/wallet-session";

/** How often to poll for the extension appearing while WALLET_NOT_INSTALLED. */
const EXTENSION_POLL_INTERVAL_MS = 2000;
/** How often to verify a connected session is still valid (catches locks/revocation mid-flow). */
const SESSION_LIVENESS_CHECK_INTERVAL_MS = 15000;

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
  // Session restore — silently reconnect on mount if a prior session is
  // still valid (extension still installed + allowed + same address). No
  // permission prompt is shown; this is what makes reloads not require a
  // fresh "Connect Wallet" click.
  // -------------------------------------------------------------------------
  useEffect(() => {
    performRestoreSession(stableDispatch);
    // Restore is a one-time, mount-only effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Persist / clear the session in sessionStorage as connection state changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (state.status === "connected" && state.publicKey && state.network && state.connectedAt) {
      saveWalletSession({
        publicKey: state.publicKey,
        network: state.network,
        connectedAt: state.connectedAt,
      });
    } else if (state.status === "disconnected") {
      clearWalletSession();
    } else if (state.status === "error" && state.errorCode === "SESSION_EXPIRED") {
      clearWalletSession();
    }
  }, [state.status, state.publicKey, state.network, state.connectedAt, state.errorCode]);

  // -------------------------------------------------------------------------
  // Auto-reconnect: while stuck on "extension not installed", poll for it
  // becoming available (installed mid-session) and resume the connect flow
  // automatically — no full page reload required.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (state.status !== "error" || state.errorCode !== "WALLET_NOT_INSTALLED") return;

    const interval = setInterval(() => {
      performCheckExtensionAvailable(stableDispatch);
    }, EXTENSION_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [state.status, state.errorCode, stableDispatch]);

  // -------------------------------------------------------------------------
  // Session liveness — while connected, periodically confirm the extension
  // still considers us authorized. Catches the wallet being locked or access
  // revoked mid-flow, which WatchWalletChanges does not reliably report.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (state.status !== "connected") return;

    const interval = setInterval(async () => {
      const stillConnected = await isFreighterConnected();
      if (!stillConnected) {
        stableDispatch({ type: "SESSION_EXPIRED" });
      }
    }, SESSION_LIVENESS_CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [state.status, stableDispatch]);

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
