import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface RequestContext {
  requestId: string;
}

const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Run a callback within a request-scoped context so that every log line
 * emitted during the request carries the same request ID.
 */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestContext.run({ requestId }, fn);
}

/**
 * Returns the request ID bound to the current async context, if any.
 */
export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

/**
 * Generates a new request ID when the incoming request does not supply one.
 */
export function resolveRequestId(incoming?: string | string[]): string {
  if (typeof incoming === 'string' && incoming.trim().length > 0) {
    return incoming.trim();
  }
  if (Array.isArray(incoming) && incoming.length > 0 && incoming[0].trim().length > 0) {
    return incoming[0].trim();
  }
  return randomUUID();
}

function formatLine(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const requestId = getRequestId();
  const parts: string[] = [new Date().toISOString(), level.toUpperCase()];
  if (requestId) {
    parts.push(`[requestId=${requestId}]`);
  }
  parts.push(message);
  if (meta && Object.keys(meta).length > 0) {
    parts.push(JSON.stringify(meta));
  }
  return parts.join(' ');
}

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const line = formatLine(level, message, meta);
  switch (level) {
    case 'error':
      console.error(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    case 'debug':
      console.debug(line);
      break;
    default:
      console.log(line);
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => emit('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => emit('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit('error', message, meta),
};

export default logger;
