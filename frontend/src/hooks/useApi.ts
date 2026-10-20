import { useCallback, useRef, useState } from 'react';

export interface ApiError {
  status: number;
  message: string;
  retryAfterMs?: number;
}

interface UseApiState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
}

const MAX_GET_RETRIES = 2;

/**
 * Parse a Retry-After header value into milliseconds.
 * Supports both delta-seconds ("120") and HTTP-date formats.
 */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
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
  if (seconds <= 0) return 'Please try again shortly.';
  if (seconds < 60) return `Please wait ${seconds} second${seconds === 1 ? '' : 's'} and try again.`;
  const minutes = Math.ceil(seconds / 60);
  return `Please wait about ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`;
}

function buildRateLimitError(retryAfterMs?: number): ApiError {
  const wait = retryAfterMs !== undefined ? formatWait(retryAfterMs) : 'Please wait a moment and try again.';
  return {
    status: 429,
    message: `Too many requests. ${wait}`,
    retryAfterMs,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useApi<T = unknown>() {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    error: null,
    loading: false,
  });
  const abortRef = useRef<AbortController | null>(null);

  const request = useCallback(
    async (url: string, init: RequestInit = {}): Promise<T | null> => {
      const method = (init.method ?? 'GET').toUpperCase();
      const isIdempotentGet = method === 'GET';

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState((prev) => ({ ...prev, loading: true, error: null }));

      let attempt = 0;
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const response = await fetch(url, { ...init, signal: controller.signal });

          if (response.status === 429) {
            const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));

            if (isIdempotentGet && attempt < MAX_GET_RETRIES) {
              attempt += 1;
              const delay = retryAfterMs ?? 1000 * attempt;
              await sleep(delay);
              continue;
            }

            const error = buildRateLimitError(retryAfterMs);
            setState({ data: null, error, loading: false });
            return null;
          }

          if (!response.ok) {
            const error: ApiError = {
              status: response.status,
              message: `Request failed with status ${response.status}.`,
            };
            setState({ data: null, error, loading: false });
            return null;
          }

          const data = (await response.json()) as T;
          setState({ data, error: null, loading: false });
          return data;
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          return null;
        }
        const error: ApiError = {
          status: 0,
          message: err instanceof Error ? err.message : 'Network request failed.',
        };
        setState({ data: null, error, loading: false });
        return null;
      }
    },
    [],
  );

  return { ...state, request };
}
