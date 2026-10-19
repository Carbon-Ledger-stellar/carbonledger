export interface ApiError extends Error {
  status?: number;
  retryAfterMs?: number;
}

export interface ApiClientOptions extends RequestInit {
  /** Max automatic retries for idempotent GET requests on 429. Default 1. */
  maxRetries?: number;
}

const DEFAULT_MAX_RETRIES = 1;

/**
 * Parse a Retry-After header value into milliseconds.
 * Supports both delta-seconds and HTTP-date formats.
 */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;

  // delta-seconds
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10) * 1000;
  }

  // HTTP-date
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }

  return undefined;
}

function formatWait(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return seconds === 1 ? '1 second' : `${seconds} seconds`;
}

function buildRateLimitMessage(retryAfterMs?: number): string {
  if (retryAfterMs !== undefined) {
    return `Too many requests. Please wait ${formatWait(retryAfterMs)} and try again.`;
  }
  return 'Too many requests. Please wait a moment and try again.';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(url: string, options: ApiClientOptions = {}): Promise<T> {
  const { maxRetries = DEFAULT_MAX_RETRIES, ...init } = options;
  const method = (init.method ?? 'GET').toUpperCase();
  const isIdempotentGet = method === 'GET';

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await fetch(url, init);

    if (response.status === 429) {
      const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));

      if (isIdempotentGet && attempt < maxRetries) {
        attempt += 1;
        const waitMs = retryAfterMs ?? 1000;
        await sleep(waitMs);
        continue;
      }

      const error = new Error(buildRateLimitMessage(retryAfterMs)) as ApiError;
      error.status = 429;
      error.retryAfterMs = retryAfterMs;
      throw error;
    }

    if (!response.ok) {
      const error = new Error(`Request failed with status ${response.status}`) as ApiError;
      error.status = response.status;
      throw error;
    }

    if (response.status === 204) {
      return undefined as unknown as T;
    }

    return (await response.json()) as T;
  }
}

export const apiClient = {
  get<T>(url: string, options: ApiClientOptions = {}): Promise<T> {
    return request<T>(url, { ...options, method: 'GET' });
  },
  post<T>(url: string, body?: unknown, options: ApiClientOptions = {}): Promise<T> {
    return request<T>(url, {
      ...options,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
      body: body !== undefined ? JSON.stringify(body) : options.body,
    });
  },
  put<T>(url: string, body?: unknown, options: ApiClientOptions = {}): Promise<T> {
    return request<T>(url, {
      ...options,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
      body: body !== undefined ? JSON.stringify(body) : options.body,
    });
  },
  delete<T>(url: string, options: ApiClientOptions = {}): Promise<T> {
    return request<T>(url, { ...options, method: 'DELETE' });
  },
};

export default apiClient;
