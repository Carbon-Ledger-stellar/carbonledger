import { v4 as uuidv4 } from "uuid";
import { CorrelationIdContext } from "./correlation-id.context";

export interface StructuredLog {
  level: "debug" | "info" | "warn" | "error";
  timestamp: string;
  service: string;
  correlationId: string;
  /** Authenticated actor ID (user sub from JWT) */
  actorId?: string;
  /** Authenticated actor role */
  actorRole?: string;
  /** HTTP endpoint that triggered this log (e.g. "POST /api/v1/credits/mint") */
  endpoint?: string;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

/**
 * StructuredLogger — lightweight structured JSON logger for use outside
 * the NestJS DI system (e.g. standalone scripts, oracle bridge, tests).
 *
 * For NestJS services, prefer injecting LoggerService which integrates
 * with Winston, CloudWatch, and AsyncLocalStorage automatically.
 */
export class StructuredLogger {
  private correlationId: string;
  private service: string;

  constructor(service: string = "carbonledger", correlationId?: string) {
    this.service = service;
    this.correlationId = correlationId || uuidv4();
  }

  getCorrelationId(): string {
    return this.correlationId;
  }

  setCorrelationId(correlationId: string): void {
    this.correlationId = correlationId;
  }

  /** @deprecated use getCorrelationId() — traceId renamed to correlationId */
  getTraceId(): string {
    return this.correlationId;
  }

  /** @deprecated use setCorrelationId() */
  setTraceId(traceId: string): void {
    this.correlationId = traceId;
  }

  private buildLog(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    context?: Record<string, unknown>,
    error?: Error,
  ): StructuredLog {
    // Prefer AsyncLocalStorage context when available (inside a NestJS request)
    const asyncCtx = CorrelationIdContext.getContext();

    return {
      level,
      timestamp: new Date().toISOString(),
      service: this.service,
      correlationId: asyncCtx?.correlationId ?? this.correlationId,
      actorId:       asyncCtx?.actorId,
      actorRole:     asyncCtx?.actorRole,
      endpoint:      asyncCtx ? `${asyncCtx.method} ${asyncCtx.path}` : undefined,
      message,
      context: this.sanitize(context),
      ...(error && {
        error: {
          message: error.message,
          stack: error.stack,
          code: (error as any).code,
        },
      }),
    };
  }

  private sanitize(
    context?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (!context) return undefined;

    const sanitized = { ...context };
    const secretKeys = ["password", "secret", "token", "key", "api_key", "private_key"];

    for (const key of Object.keys(sanitized)) {
      if (secretKeys.some((sk) => key.toLowerCase().includes(sk))) {
        sanitized[key] = "[REDACTED]";
      }
    }

    return sanitized;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    console.log(JSON.stringify(this.buildLog("debug", message, context)));
  }

  info(message: string, context?: Record<string, unknown>): void {
    console.log(JSON.stringify(this.buildLog("info", message, context)));
  }

  warn(message: string, context?: Record<string, unknown>): void {
    console.warn(JSON.stringify(this.buildLog("warn", message, context)));
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    console.error(JSON.stringify(this.buildLog("error", message, context, error)));
  }
}
