export interface ApiError extends Error {
  status?: number;
  retryAfterMs?: number;
}

const MAX_RETRIES = 2;
const DEFAULT_RETRY_AFTER_MS = 1000;

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (!trimmed) return undefined;

  const seconds = Number(trimmed);
  if (!Number.isNaN(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return undefined;
}

function formatWait(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds <= 1) return 'a moment';
  return `${seconds} seconds`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createApiError(
  message: string,
  status?: number,
  retryAfterMs?: number,
): ApiError {
  const error = new Error(message) as ApiError;
  error.status = status;
  error.retryAfterMs = retryAfterMs;
  return error;
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (data && typeof data.message === 'string') return data.message;
    if (data && typeof data.error === 'string') return data.error;
  } catch {
    // ignore non-JSON bodies
  }
  return response.statusText || `Request failed with status ${response.status}`;
}

export async function apiFetch<T = unknown>(
  input: string,
  init: RequestInit = {},
): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const isIdempotentGet = method === 'GET';

  let attempt = 0;

  while (true) {
    const response = await fetch(input, init);

    if (response.status === 429) {
      const retryAfterMs =
        parseRetryAfter(response.headers.get('Retry-After')) ??
        DEFAULT_RETRY_AFTER_MS;

      if (isIdempotentGet && attempt < MAX_RETRIES) {
        attempt += 1;
        await sleep(retryAfterMs);
        continue;
      }

      throw createApiError(
        `Too many requests. Please wait ${formatWait(retryAfterMs)} and try again.`,
        429,
        retryAfterMs,
      );
    }

    if (!response.ok) {
      const message = await parseErrorMessage(response);
      throw createApiError(message, response.status);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}
