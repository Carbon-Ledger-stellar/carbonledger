"use client";

interface SentryContext {
  componentStack?: string;
  errorType?: string;
}

function getDsnParts(dsn: string): { endpoint: string; publicKey: string } | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, "");
    if (!url.username || !projectId) return null;

    return {
      endpoint: `${url.origin}${url.pathname.replace(/\/$/, "")}/envelope/`,
      publicKey: decodeURIComponent(url.username),
    };
  } catch {
    return null;
  }
}

/** Sends a minimal Sentry envelope without exposing stack details in the UI. */
export function captureException(error: Error, context: SentryContext = {}): void {
  if (typeof window === "undefined") return;

  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  const parts = getDsnParts(dsn);
  if (!parts) return;

  const eventId = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: "error",
    exception: {
      values: [{
        type: error.name || "Error",
        value: error.message,
        stacktrace: error.stack ? { frames: [{ filename: "app", function: "ErrorBoundary", lineno: 0 }] } : undefined,
      }],
    },
    tags: context.errorType ? { error_type: context.errorType } : undefined,
    contexts: context.componentStack ? { react: { componentStack: context.componentStack } } : undefined,
    request: { url: window.location.href },
  };
  const header = {
    event_id: eventId,
    sent_at: new Date().toISOString(),
    sdk: { name: "carbonledger-sentry-envelope", version: "1.0.0" },
  };

  fetch(`${parts.endpoint}?sentry_version=7&sentry_key=${encodeURIComponent(parts.publicKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-sentry-envelope" },
    body: `${JSON.stringify(header)}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}\n`,
    keepalive: true,
  }).catch(() => {
    // Error reporting must never cause a second application failure.
  });
}
