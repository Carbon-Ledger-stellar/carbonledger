"use client";

/**
 * useNetworkStatus
 *
 * Tracks online/offline state and exposes:
 *   - isOnline          — current connectivity status
 *   - wasOffline        — true if we went offline at least once this session
 *   - reconnectedAt     — timestamp when we came back online (null if never went offline)
 *   - connectionType    — "wifi" | "cellular" | "ethernet" | "unknown" (Network Info API)
 *   - effectiveType     — "slow-2g" | "2g" | "3g" | "4g" | undefined
 *
 * Fires a "carbonledger:online" custom event when reconnecting so other
 * modules (e.g. useAuditSync) can react without prop-drilling.
 */

import { useState, useEffect, useCallback } from "react";

export interface NetworkStatus {
  isOnline: boolean;
  wasOffline: boolean;
  reconnectedAt: number | null;
  connectionType: "wifi" | "cellular" | "ethernet" | "unknown";
  effectiveType: "slow-2g" | "2g" | "3g" | "4g" | undefined;
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>(() => ({
    isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    wasOffline: false,
    reconnectedAt: null,
    connectionType: getConnectionType(),
    effectiveType: getEffectiveType(),
  }));

  const handleOnline = useCallback(() => {
    setStatus((prev) => {
      const reconnectedAt = Date.now();
      // Dispatch a custom event so sync hooks can subscribe without prop-drilling
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("carbonledger:online", { detail: { reconnectedAt } })
        );
      }
      return {
        ...prev,
        isOnline: true,
        reconnectedAt: prev.wasOffline ? reconnectedAt : prev.reconnectedAt,
        connectionType: getConnectionType(),
        effectiveType: getEffectiveType(),
      };
    });
  }, []);

  const handleOffline = useCallback(() => {
    setStatus((prev) => ({
      ...prev,
      isOnline: false,
      wasOffline: true,
      connectionType: getConnectionType(),
      effectiveType: getEffectiveType(),
    }));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Network Information API change events
    const connection = getNetworkConnection();
    if (connection) {
      connection.addEventListener("change", handleOnline);
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (connection) {
        connection.removeEventListener("change", handleOnline);
      }
    };
  }, [handleOnline, handleOffline]);

  return status;
}

// ── Network Information API helpers ──────────────────────────────────────────

type ConnectionType = NetworkStatus["connectionType"];
type EffectiveType = NetworkStatus["effectiveType"];

interface NetworkInformation extends EventTarget {
  type?: string;
  effectiveType?: EffectiveType;
}

function getNetworkConnection(): NetworkInformation | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & {
    connection?: NetworkInformation;
    mozConnection?: NetworkInformation;
    webkitConnection?: NetworkInformation;
  };
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection ?? null;
}

function getConnectionType(): ConnectionType {
  const conn = getNetworkConnection();
  if (!conn?.type) return "unknown";
  const t = conn.type.toLowerCase();
  if (t === "wifi") return "wifi";
  if (t === "cellular") return "cellular";
  if (t === "ethernet") return "ethernet";
  return "unknown";
}

function getEffectiveType(): EffectiveType {
  const conn = getNetworkConnection();
  return conn?.effectiveType;
}
