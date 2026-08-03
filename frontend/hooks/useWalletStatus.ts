"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  isFreighterInstalled,
  isFreighterConnected,
  isWrongNetwork,
  getPublicKey,
  WatchWalletChanges,
} from "../lib/freighter";
import { isWalletError } from "../lib/wallet-errors";

export type WalletStatus =
  | "loading"
  | "not_installed"
  | "locked"
  | "not_connected"
  | "wrong_network"
  | "session_expired"
  | "ready";

/** Poll for the extension appearing while not installed, so the user isn't stuck without a page reload. */
const EXTENSION_POLL_INTERVAL_MS = 2000;
/** Periodic check that a "ready" session hasn't been revoked (locked, disconnected) mid-flow. */
const SESSION_LIVENESS_CHECK_INTERVAL_MS = 15000;

export function useWalletStatus() {
  const [status, setStatus] = useState<WalletStatus>("loading");
  const [address, setAddress] = useState<string | null>(null);
  // Tracks whether we've ever reached "ready" this session, so a later loss of
  // access is reported as "session_expired" rather than plain "not_connected".
  const wasReadyRef = useRef(false);

  const checkStatus = useCallback(async () => {
    const installed = await isFreighterInstalled();
    if (!installed) {
      setStatus("not_installed");
      return;
    }

    const connected = await isFreighterConnected();
    if (!connected) {
      setStatus(wasReadyRef.current ? "session_expired" : "not_connected");
      setAddress(null);
      return;
    }

    let currentAddress: string;
    try {
      currentAddress = await getPublicKey();
    } catch (err) {
      if (isWalletError(err, "WALLET_LOCKED")) {
        setStatus("locked");
        setAddress(null);
        return;
      }
      setStatus(wasReadyRef.current ? "session_expired" : "not_connected");
      setAddress(null);
      return;
    }

    const wrongNetwork = await isWrongNetwork();
    if (wrongNetwork) {
      setStatus("wrong_network");
      setAddress(currentAddress);
      return;
    }

    wasReadyRef.current = true;
    setAddress(currentAddress);
    setStatus("ready");
  }, []);

  useEffect(() => {
    checkStatus();

    const watcher = new WatchWalletChanges();
    watcher.watch((data) => {
      setAddress(data.address || null);
      checkStatus();
    });

    return () => {
      // @ts-ignore - Some versions might have stop, others might just be a cleanup function
      if (typeof watcher.stop === "function") {
        watcher.stop();
      }
    };
  }, [checkStatus]);

  // Auto-reconnect: once the extension becomes available, resume automatically.
  useEffect(() => {
    if (status !== "not_installed") return;
    const interval = setInterval(checkStatus, EXTENSION_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [status, checkStatus]);

  // Session liveness: catch access being revoked (locked / disconnected) mid-flow.
  useEffect(() => {
    if (status !== "ready") return;
    const interval = setInterval(checkStatus, SESSION_LIVENESS_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [status, checkStatus]);

  return { status, address, refresh: checkStatus };
}
