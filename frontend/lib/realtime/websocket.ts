"use client";

/**
 * WebSocket client for real-time credit redemption updates.
 *
 * The client:
 *  - Establishes a WebSocket connection to the backend gateway upon request.
 *  - Subscribes to a user-specific channel so the server can push
 *    CREDITS_RETIRED_CONFIRMED events for that user's transactions.
 *  - Automatically reconnects with exponential backoff (capped) if the
 *    connection drops, including jitter to avoid thundering herds.
 *  - Prevents memory leaks by allowing callers to close the connection and
 *    clearing all timers on tear-down.
 *
 * The backend WebSocket gateway itself is OUT OF SCOPE for this issue — this
 * module implements only the client side, and defaults to a WS URL derived
 * from NEXT_PUBLIC_API_URL when NEXT_PUBLIC_WS_URL is not configured.
 */

import type { RealtimeEvent, ServerMessage, SubscribeMessage } from "./events";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type WebSocketConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting";

export interface ReconnectOptions {
  /** Initial delay for the first reconnection attempt, in milliseconds. */
  initialDelayMs?: number;
  /** Maximum delay between attempts, in milliseconds. */
  maxDelayMs?: number;
  /** Multiplier applied to the delay after each failed attempt. */
  multiplier?: number;
  /** Add +/- 40% random jitter to each delay to avoid synchronized retries. */
  jitter?: boolean;
  /** Maximum number of reconnection attempts before giving up (Infinity = never give up). */
  maxAttempts?: number;
}

export interface WebSocketClientOptions {
  /** Full WS(S) URL of the gateway, e.g. wss://api.example.com/ws. */
  url: string;
  /** Channel(s) to subscribe to after connecting. */
  channels: string[];
  /** Reconnection tuning. */
  reconnect?: ReconnectOptions;
  /**
   * Optional factory used to create the socket. Defaults to `new WebSocket(url)`.
   * Provided for tests and SSR environments (where WebSocket may not exist).
   */
  createSocket?: (url: string) => WebSocketLike;
  /** Fired once for every parsed realtime event received from the server. */
  onEvent?: (event: RealtimeEvent) => void;
  /** Fired on status transitions. */
  onStatusChange?: (status: WebSocketConnectionStatus) => void;
}

/** Minimal WebSocket surface used by the client (keeps tests dependency-free). */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

/** Mask values matching the WHATWG WebSocket readyState constants. */
export const ReadyStateEnum = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

export const DEFAULT_RECONNECT_OPTIONS: Required<ReconnectOptions> = {
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  multiplier: 2,
  jitter: true,
  maxAttempts: Infinity,
};

export const DEFAULT_RECONNECT_EVENTS = new Set<number>([ReadyStateEnum.CLOSED]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive a WS(S) URL from an HTTP(S) API base URL when no explicit WS URL is set. */
export function deriveWebSocketUrl(apiUrl: string | undefined): string | null {
  if (!apiUrl) return null;
  const withHttp = apiUrl.replace(/^ws(s)?:\/\//, (m) => (m === "ws://" ? "http://" : "https://"));
  const base = withHttp.replace(/\/api\/v\d+\/?$/, "").replace(/\/api\/?$/, "");
  const parsed = new URL(base);
  if (parsed.protocol === "https:") {
    return `wss://${parsed.host}${parsed.pathname.replace(/\/$/, "")}/ws`;
  }
  if (parsed.protocol === "http:") {
    return `ws://${parsed.host}${parsed.pathname.replace(/\/$/, "")}/ws`;
  }
  return null;
}

function clampDelay(delayMs: number, maxDelayMs: number): number {
  return Math.min(delayMs, maxDelayMs);
}

/** Apply +/-40% uniform jitter so reconnects don't pile up. */
function applyJitter(delayMs: number): number {
  const ratio = 0.6 + Math.random() * 0.8; // 0.6 .. 1.4
  return Math.round(delayMs * ratio);
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class RealtimeWebSocketClient {
  private readonly url: string;
  private channels: string[];
  private readonly reconnect: Required<ReconnectOptions>;
  private readonly createSocket: (url: string) => WebSocketLike;
  private readonly onEvent?: (event: RealtimeEvent) => void;
  private readonly onStatusChange?: (status: WebSocketConnectionStatus) => void;

  private socket: WebSocketLike | null = null;
  private status: WebSocketConnectionStatus = "idle";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manuallyClosed = false;

  constructor(options: WebSocketClientOptions) {
    this.url = options.url;
    this.channels = options.channels;
    this.reconnect = { ...DEFAULT_RECONNECT_OPTIONS, ...options.reconnect };
    this.createSocket = options.createSocket ?? ((u) => new WebSocket(u) as unknown as WebSocketLike);
    this.onEvent = options.onEvent;
    this.onStatusChange = options.onStatusChange;
  }

  /** Public connection status. */
  getConnectionStatus(): WebSocketConnectionStatus {
    return this.status;
  }

  /** True while a socket is open and ready for messages. */
  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === ReadyStateEnum.OPEN;
  }

  /**
   * Update the subscription channels. Applied on the next (re)connection;
   * if currently connected, the new subscription message is sent immediately.
   */
  setChannels(channels: string[]): void {
    this.channels = channels;
    if (this.isConnected() && this.socket) {
      const message: SubscribeMessage = { type: "subscribe", channels };
      try {
        this.socket.send(JSON.stringify(message));
      } catch {
        // Ignore — re-subscribed on reconnect.
      }
    }
  }

  /** Establish the connection and subscribe to the configured channels. */
  connect(): void {
    if (this.socket) {
      // Already connected — no-op.
      if (this.socket.readyState === ReadyStateEnum.OPEN) return;
      // Already connecting — don't tear down, let it finish.
      if (this.socket.readyState === ReadyStateEnum.CONNECTING) return;
      // Closing or closed — tear down and retry.
      this.teardownSocket();
    }
    this.manuallyClosed = false;
    this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
    this.openSocket();
  }

  /** Close the connection permanently and cancel any pending reconnection timers. */
  close(): void {
    this.manuallyClosed = true;
    this.clearReconnectTimer();
    this.teardownSocket();
    this.reconnectAttempt = 0;
    this.setStatus("disconnected");
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private openSocket(): void {
    let socket: WebSocketLike;
    try {
      socket = this.createSocket(this.url);
    } catch {
      // Factory threw (e.g. WebSocket unavailable) — schedule a retry if not closed.
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return; // stale socket
      this.reconnectAttempt = 0;
      this.setStatus("connected");
      const message: SubscribeMessage = { type: "subscribe", channels: this.channels };
      try {
        socket.send(JSON.stringify(message));
      } catch {
        // Ignore — the message will be re-subscribed on reconnect.
      }
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      const parsed = this.parseMessage(event.data);
      if (parsed) this.onEvent?.(parsed);
    };

    socket.onerror = () => {
      // Errors are typically followed by onclose — let onclose drive reconnection.
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.scheduleReconnect();
    };
  }

  private parseMessage(data: unknown): RealtimeEvent | null {
    if (typeof data !== "string") {
      // Protocol buffers/Blobs are not supported — the gateway sends JSON.
      return null;
    }
    try {
      const msg = JSON.parse(data) as ServerMessage;
      if (msg && msg.event && msg.event.type) {
        return msg.event;
      }
      // Tolerate a bare event object as well, e.g. { "type": "CREDITS_RETIRED_CONFIRMED", ... }.
      // Refuse to accept messages that have an error field but no event.
      if (msg && (msg as unknown as RealtimeEvent).type && !msg.error) {
        return msg as unknown as RealtimeEvent;
      }
      return null;
    } catch {
      return null;
    }
  }

  private scheduleReconnect(): void {
    if (this.manuallyClosed) return;
    if (this.reconnectTimer) return; // already scheduled

    this.reconnectAttempt += 1;
    if (this.reconnectAttempt > this.reconnect.maxAttempts) {
      this.setStatus("disconnected");
      return;
    }

    const delay = this.computeReconnectDelay(this.reconnectAttempt);
    this.setStatus("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private computeReconnectDelay(attempt: number): number {
    const base =
      this.reconnect.initialDelayMs *
      Math.pow(this.reconnect.multiplier, attempt - 1);
    const clamped = clampDelay(base, this.reconnect.maxDelayMs);
    return this.reconnect.jitter ? applyJitter(clamped) : clamped;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private teardownSocket(): void {
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        // Ignore — the socket may already be closed.
      }
    }
  }

  private setStatus(status: WebSocketConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatusChange?.(status);
  }
}