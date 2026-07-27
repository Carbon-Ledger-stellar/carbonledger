import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import * as winston from 'winston';
import CloudWatchTransport from 'winston-cloudwatch';
import { CorrelationIdContext } from './correlation-id.context';

export interface LogContext {
  /** Request trace / correlation identifier. Auto-injected if not supplied. */
  correlationId?: string;
  /** Alias for correlationId kept for backward compatibility. */
  trace_id?: string;
  /** Stellar public key of the authenticated user. */
  actor?: string;
  /** User role: project_developer | corporation | verifier | admin. */
  role?: string;
  /** Logical endpoint label, e.g. "POST /api/v1/credits/mint". */
  endpoint?: string;
  user_id?: string;
  contract_id?: string;
  [key: string]: unknown;
}

/**
 * Sampling strategy
 * -----------------
 * Acceptance criteria requires:
 *   - 100 % of error-level logs are always written
 *   - 10 %  of info/debug/verbose logs are sampled
 *   - warn  logs are always written (they indicate potential problems)
 *
 * The sampling rate is configurable via LOG_SAMPLE_RATE (0–1, default 0.1).
 * Setting LOG_SAMPLE_RATE=1 disables sampling (useful in development/testing).
 */
const SAMPLE_RATE = parseFloat(process.env.LOG_SAMPLE_RATE ?? '0.1');

function shouldSample(level: string): boolean {
  // Errors and warnings are never dropped
  if (level === 'error' || level === 'warn') return true;
  // Full capture when rate is 1 or in test environment
  if (SAMPLE_RATE >= 1 || process.env.NODE_ENV === 'test') return true;
  return Math.random() < SAMPLE_RATE;
}

@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly winstonLogger: winston.Logger;

  constructor() {
    const transports: winston.transport[] = [
      new winston.transports.Console({
        silent: process.env.NODE_ENV === 'test',
      }),
    ];

    if (process.env.AWS_CLOUDWATCH_GROUP) {
      const instanceId = process.env.INSTANCE_ID ?? process.env.HOSTNAME ?? 'local';
      transports.push(
        new CloudWatchTransport({
          logGroupName: process.env.AWS_CLOUDWATCH_GROUP,
          // Include instance ID to prevent log stream collisions in multi-pod deployments
          logStreamName: `backend-${process.env.NODE_ENV ?? 'development'}-${instanceId}-${new Date().toISOString().slice(0, 10)}`,
          awsRegion: process.env.AWS_REGION ?? 'us-east-1',
          jsonMessage: true,
          retentionInDays: 90,
        }),
      );
    }

    this.winstonLogger = winston.createLogger({
      level: process.env.LOG_LEVEL ?? 'info',
      format: winston.format.combine(
        // Always emit ISO 8601 timestamp
        winston.format.timestamp(),
        // Unpack Error objects into { message, stack }
        winston.format.errors({ stack: true }),
        // Redact sensitive fields before serialising
        winston.format((info) => {
          sanitizeInPlace(info);
          return info;
        })(),
        // Emit single-line JSON — compatible with ELK, CloudWatch Insights, etc.
        winston.format.json(),
      ),
      defaultMeta: {
        service: 'carbonledger-backend',
        env: process.env.NODE_ENV ?? 'development',
      },
      transports,
    });
  }

  // ── Context helpers ────────────────────────────────────────────────────────

  /**
   * Merge the current AsyncLocalStorage context (correlationId, actor, role,
   * endpoint) into the supplied LogContext object.  Caller-supplied values
   * always win, so services can override the auto-injected fields when needed.
   */
  private enrichWithContext(ctx?: LogContext | string): LogContext {
    const base: LogContext =
      typeof ctx === 'string' ? { context: ctx } : (ctx ?? {});

    const store = CorrelationIdContext.getContext();

    return {
      correlationId: base.correlationId ?? store?.correlationId ?? undefined,
      actor:         base.actor         ?? store?.actor         ?? undefined,
      role:          base.role          ?? store?.role          ?? undefined,
      endpoint:      base.endpoint      ?? store?.endpoint      ?? undefined,
      ...base,
    };
  }

  // ── NestLoggerService interface ────────────────────────────────────────────

  log(message: string, context?: LogContext | string): void {
    if (!shouldSample('info')) return;
    const meta = this.enrichWithContext(context);
    this.winstonLogger.info(message, meta);
  }

  error(message: string, trace?: string, context?: LogContext | string): void {
    // Errors are ALWAYS written — no sampling
    const meta = this.enrichWithContext(context);
    this.winstonLogger.error(message, { ...meta, trace });
  }

  warn(message: string, context?: LogContext | string): void {
    // Warnings are always written
    const meta = this.enrichWithContext(context);
    this.winstonLogger.warn(message, meta);
  }

  debug(message: string, context?: LogContext | string): void {
    if (!shouldSample('debug')) return;
    const meta = this.enrichWithContext(context);
    this.winstonLogger.debug(message, meta);
  }

  verbose(message: string, context?: LogContext | string): void {
    if (!shouldSample('verbose')) return;
    const meta = this.enrichWithContext(context);
    this.winstonLogger.verbose(message, meta);
  }

  // ── Convenience helpers ────────────────────────────────────────────────────

  /**
   * Returns the current correlation ID from AsyncLocalStorage.
   * Useful when services need to pass the ID to external calls (DB, oracle).
   */
  getCorrelationId(): string {
    return CorrelationIdContext.getCorrelationId();
  }

  /**
   * Enrich the current request context with actor/role information.
   * Called from the LoggingInterceptor after JWT authentication completes.
   */
  setRequestActor(actor: string, role: string): void {
    CorrelationIdContext.enrichContext({ actor, role });
  }

  // ── Expose underlying winston instance for advanced use ───────────────────
  /** @internal Used by tests that need to inspect transport calls. */
  get _winston(): winston.Logger {
    return this.winstonLogger;
  }
}

// ── Sensitive field sanitiser ──────────────────────────────────────────────

const REDACTED_KEYS = new Set([
  'password', 'secret', 'token', 'key', 'api_key',
  'private_key', 'privatekey', 'authorization', 'cookie',
  'x-api-key', 'access_token', 'refresh_token',
]);

function sanitizeInPlace(obj: Record<string, unknown>): void {
  for (const k of Object.keys(obj)) {
    if (REDACTED_KEYS.has(k.toLowerCase())) {
      obj[k] = '[REDACTED]';
    } else if (obj[k] !== null && typeof obj[k] === 'object') {
      sanitizeInPlace(obj[k] as Record<string, unknown>);
    }
  }
}
