import { Injectable, LoggerService as NestLoggerService } from "@nestjs/common";
import * as winston from "winston";
import CloudWatchTransport from "winston-cloudwatch";
import { CorrelationIdContext } from "./correlation-id.context";

export interface LogContext {
  /** Correlation ID for the current request (auto-injected if not supplied) */
  correlationId?: string;
  /** Authenticated actor ID */
  actorId?: string;
  /** Authenticated actor role */
  actorRole?: string;
  /** Soroban contract ID involved in this operation */
  contractId?: string;
  /** Any extra structured fields */
  [key: string]: unknown;
}

/**
 * Structured JSON logger for CarbonLedger backend.
 *
 * Every log line is a JSON object with at minimum:
 *   { timestamp, level, service, correlationId, message }
 *
 * Sampling strategy:
 *   - ERROR / WARN: always emitted (100%)
 *   - INFO / DEBUG / VERBOSE: emitted only when the request is sampled (10%)
 *     OR when called outside a request context (background jobs, startup)
 *
 * The sampling decision is stored per-request in AsyncLocalStorage so it
 * is consistent across all log calls for a single request.
 */
@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly logger: winston.Logger;

  constructor() {
    const transports: winston.transport[] = [
      new winston.transports.Console({
        silent: process.env.NODE_ENV === "test",
      }),
    ];

    if (process.env.AWS_CLOUDWATCH_GROUP) {
      transports.push(
        new CloudWatchTransport({
          logGroupName: process.env.AWS_CLOUDWATCH_GROUP,
          logStreamName: `backend-${process.env.NODE_ENV ?? "development"}-${new Date().toISOString().slice(0, 10)}`,
          awsRegion: process.env.AWS_REGION ?? "us-east-1",
          jsonMessage: true,
          retentionInDays: 90,
        }),
      );
    }

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL ?? "info",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
      defaultMeta: { service: "carbonledger-backend" },
      transports,
    });
  }

  // ── Context enrichment ──────────────────────────────────────────────────────

  /**
   * Merge caller-supplied context with the correlation context from
   * AsyncLocalStorage so every log line carries the full request envelope.
   */
  private enrichContext(context?: LogContext | string): LogContext {
    const base =
      typeof context === "string" ? { context } : { ...(context ?? {}) };

    const asyncCtx = CorrelationIdContext.getContext();

    return {
      correlationId: base.correlationId || asyncCtx?.correlationId || undefined,
      actorId:       base.actorId       || asyncCtx?.actorId        || undefined,
      actorRole:     base.actorRole     || asyncCtx?.actorRole      || undefined,
      endpoint:      asyncCtx ? `${asyncCtx.method} ${asyncCtx.path}` : undefined,
      ...base,
    };
  }

  // ── Sampling gate ───────────────────────────────────────────────────────────

  /**
   * Returns true for log levels that should bypass sampling (errors always log).
   */
  private isHighPriority(level: string): boolean {
    return level === "error" || level === "warn";
  }

  /**
   * Apply the sampling decision.
   * High-priority levels always pass. Normal levels are gated at 10%.
   */
  private shouldEmit(level: string): boolean {
    if (this.isHighPriority(level)) {
      // Errors upgrade the sampling decision so subsequent info logs in the
      // same request are also emitted for full context
      CorrelationIdContext.forceSample();
      return true;
    }
    return CorrelationIdContext.shouldSample();
  }

  // ── Write helpers ───────────────────────────────────────────────────────────

  private write(level: string, message: string, context?: LogContext | string) {
    if (!this.shouldEmit(level)) return;
    const meta = this.enrichContext(context);
    this.logger.log(level, message, meta);
  }

  // ── NestJS LoggerService interface ─────────────────────────────────────────

  log(message: string, context?: LogContext | string) {
    this.write("info", message, context);
  }

  error(message: string, trace?: string, context?: LogContext | string) {
    // Errors always emit
    const meta = this.enrichContext(context);
    CorrelationIdContext.forceSample();
    this.logger.error(message, { ...meta, trace });
  }

  warn(message: string, context?: LogContext | string) {
    this.write("warn", message, context);
  }

  debug(message: string, context?: LogContext | string) {
    this.write("debug", message, context);
  }

  verbose(message: string, context?: LogContext | string) {
    this.write("verbose", message, context);
  }

  // ── Oracle / DB tracing helpers ────────────────────────────────────────────

  /**
   * Log an outbound oracle call with the current correlation context.
   * Use this in oracle.service.ts before every Soroban RPC call.
   */
  logOracleCall(operation: string, params: Record<string, unknown>): void {
    this.write("info", `oracle_call: ${operation}`, {
      oracleOperation: operation,
      oracleParams: params,
    });
  }

  /**
   * Log a database query with the current correlation context.
   * Use this in prisma.service.ts via the $on('query') event.
   */
  logDbQuery(query: string, durationMs: number): void {
    this.write("debug", "db_query", {
      dbQuery: query.slice(0, 200), // truncate long queries
      durationMs,
    });
  }
}
