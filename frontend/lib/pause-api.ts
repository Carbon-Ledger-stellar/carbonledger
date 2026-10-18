const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export interface PauseStatusResponse {
  paused: boolean;
  reason: string | null;
  pausedAt: string | null;
  pausedBy: string | null;
  updatedAt: string | null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Normalize the camelCase and snake_case payloads used by the pause APIs. */
export function normalizePauseStatus(payload: unknown): PauseStatusResponse {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid pause status response");
  }

  const data = payload as Record<string, unknown>;
  const paused = data.paused ?? data.is_paused ?? data.isPaused;
  if (typeof paused !== "boolean") {
    throw new Error("Invalid pause status response: paused must be a boolean");
  }

  return {
    paused,
    reason: paused ? optionalString(data.reason ?? data.pause_reason) : null,
    pausedAt: paused ? optionalString(data.pausedAt ?? data.paused_at) : null,
    pausedBy: paused ? optionalString(data.pausedBy ?? data.paused_by) : null,
    updatedAt: optionalString(data.updatedAt ?? data.updated_at),
  };
}

/** NEXT_PUBLIC_API_URL includes the API/version prefix, like the other API clients. */
export async function fetchPauseStatus(signal?: AbortSignal): Promise<PauseStatusResponse> {
  const response = await fetch(`${API_BASE_URL.replace(/\/$/, "")}/pause/status`, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.message || `Failed to load pause status (${response.status})`);
  }

  return normalizePauseStatus(await response.json());
}
