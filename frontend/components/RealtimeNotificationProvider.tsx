"use client";

/**
 * RealtimeNotificationProvider — bridges WebSocket events to the Toast system.
 *
 * When the user is authenticated (wallet connected), the provider establishes a
 * WebSocket connection to the backend gateway, subscribes to the user's channel,
 * and listens for CREDITS_RETIRED_CONFIRMED events. When such an event arrives,
 * a success toast notification is shown immediately.
 *
 * On logout / disconnect the WebSocket is closed cleanly. If the connection
 * drops, the client automatically reconnects with exponential backoff.
 *
 * The provider mounts a fixed-position <Toast /> container in the DOM so that
 * notifications appear regardless of which page the user is on.
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import { useWallet } from "../lib/wallet/WalletContext";
import { RealtimeWebSocketClient } from "../lib/realtime/websocket";
import { RealtimeEventType } from "../lib/realtime/events";
import type { CreditsRetiredConfirmedPayload } from "../lib/realtime/events";
import { dispatchRealtimeEvent } from "../hooks/useTransactionStatus";
import Toast, { useToast } from "./Toast";

function deriveWsUrl(): string | null {
  // Explicit WS URL takes precedence
  const explicit = process.env.NEXT_PUBLIC_WS_URL;
  if (explicit) return explicit;

  // Fallback: derive from the API URL
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) return null;

  const withHttp = apiUrl.replace(/^ws(s)?:\/\//, (m) =>
    m === "ws://" ? "http://" : "https://",
  );
  const base = withHttp
    .replace(/\/api\/v\d+\/?$/, "")
    .replace(/\/api\/?$/, "");
  try {
    const parsed = new URL(base);
    const scheme = parsed.protocol === "https:" ? "wss:" : "ws:";
    return `${scheme}//${parsed.host}${parsed.pathname.replace(/\/$/, "")}/ws`;
  } catch {
    return null;
  }
}

export default function RealtimeNotificationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { publicKey, isConnected: walletConnected } = useWallet();
  const { toasts, addToast, dismiss } = useToast();
  const [wsStatus, setWsStatus] = useState<string>("idle");

  const client = useMemo(() => {
    const wsUrl = deriveWsUrl();
    if (!wsUrl) return null;

    return new RealtimeWebSocketClient({
      url: wsUrl,
      channels: publicKey ? [`user:${publicKey}`] : [],
      reconnect: {
        initialDelayMs: 1_000,
        maxDelayMs: 30_000,
        multiplier: 2,
        jitter: true,
        maxAttempts: Infinity,
      },
      onEvent: (event) => {
        if (event.type === RealtimeEventType.CREDITS_RETIRED_CONFIRMED) {
          const payload = event.payload as CreditsRetiredConfirmedPayload;
          addToast({
            type: "success",
            title: "Credits Retired Successfully",
            message: `${payload.amount} tCO₂e retired for ${payload.beneficiary}`,
            txHash: payload.txHash,
          });
        }
        // Always dispatch to the event bus so other hooks can react.
        dispatchRealtimeEvent(event);
      },
      onStatusChange: (status) => {
        setWsStatus(status);
      },
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Connect / disconnect based on wallet auth state.
  useEffect(() => {
    if (!client) return;

    if (walletConnected && publicKey) {
      // Update channels to include the current user.
      client.setChannels([`user:${publicKey}`]);
      client.connect();
    } else {
      client.close();
    }
  }, [client, walletConnected, publicKey]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      client?.close();
    };
  }, [client]);

  return (
    <>
      {children}
      <Toast toasts={toasts} onDismiss={dismiss} />
      {/* Invisible status indicator for accessibility */}
      <div
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}
      >
        {wsStatus !== "idle" && wsStatus !== "connected"
          ? `Realtime connection: ${wsStatus}`
          : null}
      </div>
    </>
  );
}