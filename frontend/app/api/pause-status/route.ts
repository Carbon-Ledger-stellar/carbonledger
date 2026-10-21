/**
 * GET /api/pause-status — returns the current pause state for all tracked
 * contracts (#1253).
 *
 * This is a thin proxy to the backend `/api/v1/admin/pause-status` endpoint.
 * It exists so that the `usePauseStatusToast` polling fallback can hit a
 * same-origin URL (avoiding CORS) and so that the response shape is normalised
 * to what the hook expects regardless of future backend changes.
 *
 * When the backend is unreachable the route returns a 503 with an empty
 * `statuses` array so the hook can silently degrade rather than showing an
 * error toast.
 *
 * Response shape:
 * {
 *   "statuses": [
 *     {
 *       "contractName": "carbon_credit",
 *       "contractId": "C...",
 *       "isPaused": false,
 *       "reason": null,
 *       "pausedUntil": null
 *     },
 *     ...
 *   ]
 * }
 */

import { NextResponse } from "next/server";

const BACKEND_URL =
  process.env.BACKEND_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3001";

const PAUSE_STATUS_PATH = "/api/v1/admin/pause-status";

export const dynamic = "force-dynamic";
// Re-validate at most every 10 seconds so multiple concurrent users don't
// hammer the backend, but stale data is still fresh enough for ops alerting.
export const revalidate = 10;

export async function GET(): Promise<NextResponse> {
  try {
    const url = `${BACKEND_URL.replace(/\/$/, "")}${PAUSE_STATUS_PATH}`;

    const res = await fetch(url, {
      headers: {
        // The backend endpoint is internal — use a service-to-service token
        // from an env var if configured, otherwise no auth (useful in dev).
        ...(process.env.INTERNAL_SERVICE_TOKEN
          ? { Authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN}` }
          : {}),
      },
      // Short timeout — polling fallback should fail fast
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      // Forward a degraded response so the hook can silently skip
      return NextResponse.json(
        {
          statuses: [],
          error: `Backend returned ${res.status}`,
        },
        { status: 503 },
      );
    }

    const data = await res.json();

    // Normalise: the backend may return { carbon_credit: {...}, ... } or
    // { statuses: [...] } depending on the implementation.
    if (Array.isArray(data?.statuses)) {
      return NextResponse.json({ statuses: data.statuses });
    }

    // Fallback: backend returns AdminConfig-shaped object — map it ourselves
    const statuses = Object.entries(data as Record<string, unknown>)
      .filter(([k]) => !k.endsWith("_until"))
      .map(([contractName, value]) => ({
        contractName,
        contractId: "",
        isPaused: value === true || value === "true",
        reason: null,
        pausedUntil: (data as any)[`${contractName}_until`] ?? null,
      }));

    return NextResponse.json({ statuses });
  } catch {
    // Backend unreachable — return empty statuses rather than 500
    return NextResponse.json({ statuses: [] }, { status: 503 });
  }
}
