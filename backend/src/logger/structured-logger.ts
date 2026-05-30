import { v4 as uuidv4 } from "uuid";

export interface StructuredLog {
  level: "debug" | "info" | "warn" | "error";
  timestamp: string;
  service: string;
  trace_id: string;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

export class StructuredLogger {
  private traceId: string;
  private service: string;

  constructor(service: string = "carbonledger", traceId?: string) {
    this.service = service;
    this.traceId = traceId || uuidv4();
  }

  getTraceId(): string {
    return this.traceId;
  }

  setTraceId(traceId: string): void {
    this.traceId = traceId;
  }

  private formatLog(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    context?: Record<string, unknown>,
    error?: Error,
  ): StructuredLog {
    return {
      level,
      timestamp: new Date().toISOString(),
      service: this.service,
      trace_id: this.traceId,
      message,
      context: this.sanitizeContext(context),
      ...(error && {
        error: {
          message: error.message,
          stack: error.stack,
          code: (error as any).code,
        },
      }),
    };
  }

  private sanitizeContext(
    context?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (!context) return undefined;

    const sanitized = { ...context };
    const secretKeys = [
      "password",
      "secret",
      "token",
      "key",
      "api_key",
      "private_key",
    ];

    for (const key of Object.keys(sanitized)) {
      if (secretKeys.some((sk) => key.toLowerCase().includes(sk))) {
        sanitized[key] = "[REDACTED]";
      }
    }

    return sanitized;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    const log = this.formatLog("debug", message, context);
    console.log(JSON.stringify(log));
  }

  info(message: string, context?: Record<string, unknown>): void {
    const log = this.formatLog("info", message, context);
    console.log(JSON.stringify(log));
  }

  warn(message: string, context?: Record<string, unknown>): void {
    const log = this.formatLog("warn", message, context);
    console.warn(JSON.stringify(log));
  }

  error(
    message: string,
    error?: Error,
    context?: Record<string, unknown>,
  ): void {
    const log = this.formatLog("error", message, context, error);
    console.error(JSON.stringify(log));
  }
}
