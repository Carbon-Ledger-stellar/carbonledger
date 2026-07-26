"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

/**
 * Real-time verifier notifications.
 *
 * Subscribes to the backend NotificationsGateway over Socket.io and surfaces
 * events as they arrive. If the socket cannot be established (proxy blocking
 * upgrades, backend without the gateway, offline), it degrades to polling the
 * pending-projects endpoint every 60s so a verifier still learns about new work.
 */

const API =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

/**
 * Socket namespace lives at the server root, not under the /api/v1 prefix.
 * NEXT_PUBLIC_WS_URL overrides it for deployments that terminate WebSockets on
 * a different host (and for e2e tests, which point it at a stub gateway).
 */
function socketOrigin(): string {
  // Runtime override, set before hydration. NEXT_PUBLIC_* is inlined at build
  // time, which e2e runs can't vary per-test; this seam lets them point at a
  // per-worker stub gateway.
  const runtime =
    typeof window !== "undefined"
      ? (window as { __CL_WS_URL__?: string }).__CL_WS_URL__
      : undefined;
  if (runtime) return runtime;

  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  try {
    return new URL(API).origin;
  } catch {
    return "http://localhost:3001";
  }
}

export const VERIFIER_EVENTS = {
  PROJECT_PENDING_VERIFICATION: "project.pending_verification",
  PROJECT_VERIFICATION_DEADLINE_24H: "project.verification_deadline_24h",
  ORACLE_MONITORING_STALE: "oracle.monitoring_stale",
} as const;

export type VerifierEventName =
  (typeof VERIFIER_EVENTS)[keyof typeof VERIFIER_EVENTS];

export interface VerifierNotification {
  /** Stable client-side id so React keys and dedupe both work. */
  id: string;
  event: VerifierEventName;
  projectId: string;
  name: string;
  receivedAt: string;
  /** Full server payload — shape varies per event. */
  data: Record<string, unknown>;
}

export type NotificationTransport = "websocket" | "polling" | "disconnected";

interface UseVerifierNotificationsOptions {
  /** JWT access token. When absent the hook stays idle. */
  token?: string | null;
  /** Verifier's wallet address — used by the polling fallback. */
  publicKey?: string | null;
  /** Called for each new notification (e.g. to refresh a list). */
  onNotification?: (n: VerifierNotification) => void;
  /** Set false to disable the browser Notification API. */
  desktopNotifications?: boolean;
}

const POLL_INTERVAL_MS = 60_000;

/** Human-readable title per event, used for the desktop notification. */
const TITLES: Record<VerifierEventName, string> = {
  [VERIFIER_EVENTS.PROJECT_PENDING_VERIFICATION]: "New project awaiting review",
  [VERIFIER_EVENTS.PROJECT_VERIFICATION_DEADLINE_24H]:
    "Verification deadline in 24h",
  [VERIFIER_EVENTS.ORACLE_MONITORING_STALE]: "Monitoring data is stale",
};

export function useVerifierNotifications({
  token,
  publicKey,
  onNotification,
  desktopNotifications = true,
}: UseVerifierNotificationsOptions) {
  const [notifications, setNotifications] = useState<VerifierNotification[]>([]);
  const [transport, setTransport] = useState<NotificationTransport>("disconnected");
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    "default",
  );

  const socketRef = useRef<Socket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seenProjectIds = useRef<Set<string>>(new Set());
  // Kept in a ref so changing the callback doesn't tear down the socket.
  const onNotificationRef = useRef(onNotification);
  onNotificationRef.current = onNotification;

  const showDesktopNotification = useCallback(
    (n: VerifierNotification) => {
      if (!desktopNotifications) return;
      if (typeof window === "undefined" || !("Notification" in window)) return;
      if (Notification.permission !== "granted") return;

      try {
        new Notification(TITLES[n.event] ?? "CarbonLedger", {
          body: n.name ? `${n.name} (${n.projectId})` : n.projectId,
          tag: `${n.event}:${n.projectId}`, // collapses duplicates
        });
      } catch {
        // Some browsers throw on constructing Notification outside a SW context.
      }
    },
    [desktopNotifications],
  );

  const push = useCallback(
    (event: VerifierEventName, data: Record<string, unknown>) => {
      const projectId = String(data.projectId ?? "");
      const notification: VerifierNotification = {
        id: `${event}:${projectId}:${data.emittedAt ?? Date.now()}`,
        event,
        projectId,
        name: String(data.name ?? ""),
        receivedAt: new Date().toISOString(),
        data,
      };

      setNotifications((prev) =>
        prev.some((p) => p.id === notification.id)
          ? prev
          : [notification, ...prev].slice(0, 50),
      );
      seenProjectIds.current.add(projectId);
      showDesktopNotification(notification);
      onNotificationRef.current?.(notification);
    },
    [showDesktopNotification],
  );

  /** Ask once, on first connection, per the acceptance criteria. */
  const requestPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    if (Notification.permission !== "default") {
      setPermission(Notification.permission);
      return;
    }
    try {
      setPermission(await Notification.requestPermission());
    } catch {
      setPermission(Notification.permission);
    }
  }, []);

  // ── Polling fallback ───────────────────────────────────────────────────────
  const startPolling = useCallback(() => {
    if (pollRef.current || !token || !publicKey) return;

    const poll = async () => {
      try {
        const res = await fetch(
          `${API}/verifiers/${publicKey}/pending-projects`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) return;
        const projects: Array<{ projectId: string; name: string }> =
          await res.json();

        for (const project of projects) {
          if (seenProjectIds.current.has(project.projectId)) continue;
          push(VERIFIER_EVENTS.PROJECT_PENDING_VERIFICATION, {
            projectId: project.projectId,
            name: project.name,
            emittedAt: new Date().toISOString(),
          });
        }
      } catch {
        // Network blip — the next tick retries.
      }
    };

    setTransport("polling");
    void poll(); // don't make the verifier wait a full minute for the first read
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }, [token, publicKey, push]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // ── Socket lifecycle ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) {
      setTransport("disconnected");
      return;
    }

    let cancelled = false;
    const socket = io(`${socketOrigin()}/notifications`, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnectionAttempts: 5,
      reconnectionDelay: 2_000,
      timeout: 10_000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      if (cancelled) return;
      setTransport("websocket");
      stopPolling();
      void requestPermission();
    });

    // Any failure to reach the gateway falls back to polling rather than
    // leaving the verifier with no signal at all.
    const degrade = () => {
      if (cancelled) return;
      startPolling();
    };

    socket.on("connect_error", degrade);
    socket.on("disconnect", degrade);
    socket.on("unauthorized", () => {
      if (cancelled) return;
      setTransport("disconnected");
      stopPolling();
    });

    socket.on(VERIFIER_EVENTS.PROJECT_PENDING_VERIFICATION, (d) =>
      push(VERIFIER_EVENTS.PROJECT_PENDING_VERIFICATION, d),
    );
    socket.on(VERIFIER_EVENTS.PROJECT_VERIFICATION_DEADLINE_24H, (d) =>
      push(VERIFIER_EVENTS.PROJECT_VERIFICATION_DEADLINE_24H, d),
    );
    socket.on(VERIFIER_EVENTS.ORACLE_MONITORING_STALE, (d) =>
      push(VERIFIER_EVENTS.ORACLE_MONITORING_STALE, d),
    );

    return () => {
      cancelled = true;
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      stopPolling();
      setTransport("disconnected");
    };
  }, [token, publicKey, push, requestPermission, startPolling, stopPolling]);

  const clear = useCallback(() => setNotifications([]), []);

  return {
    notifications,
    transport,
    connected: transport === "websocket",
    permission,
    requestPermission,
    clear,
  };
}

export default useVerifierNotifications;
