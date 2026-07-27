"use client";

import { useState, useEffect } from "react";
import {
  isFreighterInstalled,
  isFreighterConnected,
  isWrongNetwork,
  WatchWalletChanges,
} from "../lib/freighter";

export type WalletStatus = "loading" | "not_installed" | "not_connected" | "wrong_network" | "ready";

export function useWalletStatus() {
  const [status, setStatus] = useState<WalletStatus>("loading");
  const [address, setAddress] = useState<string | null>(null);

  const checkStatus = async () => {
    const installed = await isFreighterInstalled();
    if (!installed) {
      setStatus("not_installed");
      return;
    }

    const connected = await isFreighterConnected();
    if (!connected) {
      setStatus("not_connected");
      return;
    }

    const wrongNetwork = await isWrongNetwork();
    if (wrongNetwork) {
      setStatus("wrong_network");
      return;
    }

    setStatus("ready");
  };

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
  }, []);

  return { status, address, refresh: checkStatus };
}
