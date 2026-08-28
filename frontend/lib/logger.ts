"use client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

interface LogPayload {
  level: "error" | "warn";
  message: string;
  trace_id?: string;
  user_id?: string;
  contract_id?: string;
  stack?: string;
  url?: string;
  [key: string]: unknown;
}

function send(payload: LogPayload): void {
  if (!API_URL) return;
  // Use sendBeacon when available so logs survive page unload
  const body = JSON.stringify({ ...payload, url: window.location.href });
  if (navigator.sendBeacon) {
    navigator.sendBeacon(`${API_URL}/logs`, new Blob([body], { type: "application/json" }));
  } else {
    fetch(`${API_URL}/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {/* swallow — logging must never break the app */});
  }
}

export const clientLogger = {
  error(message: string, extra?: Omit<LogPayload, "level" | "message">) {
    send({ level: "error", message, ...extra });
  },
  warn(message: string, extra?: Omit<LogPayload, "level" | "message">) {
    send({ level: "warn", message, ...extra });
  },
};

/** Call once in the root layout to capture unhandled errors and promise rejections. */
export function initGlobalErrorHandlers(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (event) => {
    clientLogger.error(event.message, {
      stack: event.error?.stack,
      source: `${event.filename}:${event.lineno}:${event.colno}`,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    clientLogger.error(
      reason instanceof Error ? reason.message : String(reason),
      { stack: reason instanceof Error ? reason.stack : undefined },
    );
  });
}
