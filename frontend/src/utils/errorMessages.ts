export interface ApiErrorLike {
  status?: number;
  statusCode?: number;
  retryAfter?: number | string | null;
  headers?: Record<string, string | undefined>;
  message?: string;
}

const DEFAULT_RATE_LIMIT_WAIT_SECONDS = 30;

/**
 * Parse a Retry-After header value. Supports both delay-seconds and HTTP-date
 * formats as defined by RFC 7231. Returns a wait time in seconds, or null when
 * the value cannot be interpreted.
 */
export function parseRetryAfter(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.ceil(value) : null;
  }

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const deltaSeconds = Math.ceil((dateMs - Date.now()) / 1000);
    return deltaSeconds > 0 ? deltaSeconds : 0;
  }

  return null;
}

function getStatus(error: ApiErrorLike): number | undefined {
  return error.status ?? error.statusCode;
}

function getRetryAfter(error: ApiErrorLike): number | null {
  if (error.retryAfter !== undefined && error.retryAfter !== null) {
    return parseRetryAfter(error.retryAfter);
  }

  if (error.headers) {
    const headerValue =
      error.headers['retry-after'] ?? error.headers['Retry-After'];
    if (headerValue !== undefined) {
      return parseRetryAfter(headerValue);
    }
  }

  return null;
}

function formatWait(seconds: number): string {
  if (seconds <= 0) {
    return 'a moment';
  }
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * Returns true when the error represents a 429 rate-limit response.
 */
export function isRateLimitError(error: ApiErrorLike | null | undefined): boolean {
  if (!error) {
    return false;
  }
  return getStatus(error) === 429;
}

/**
 * Build a user-facing message for a rate-limited request that explains the
 * wait instead of showing a generic error.
 */
export function getRateLimitMessage(error: ApiErrorLike | null | undefined): string {
  const waitSeconds = error ? getRetryAfter(error) : null;
  const seconds = waitSeconds ?? DEFAULT_RATE_LIMIT_WAIT_SECONDS;
  return `Too many requests. Please wait ${formatWait(seconds)} and try again.`;
}

/**
 * Resolve a user-facing error message. Rate-limit (429) responses get a
 * dedicated retry hint; everything else falls back to the provided message.
 */
export function getErrorMessage(
  error: ApiErrorLike | null | undefined,
  fallback = 'Something went wrong. Please try again.'
): string {
  if (isRateLimitError(error)) {
    return getRateLimitMessage(error);
  }
  return error?.message || fallback;
}
