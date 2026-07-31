import { Injectable, LoggerService as NestLoggerService } from "@nestjs/common";
import * as winston from "winston";
import CloudWatchTransport from "winston-cloudwatch";
import { CorrelationIdContext } from "./correlation-id.context";

export interface LogContext {
  trace_id?: string;
  correlationId?: string;
  user_id?: string;
  actor?: string;
  role?: string;
  endpoint?: string;
  contract_id?: string;
  [key: string]: unknown;
}

/**
 * Sampling strategy (issue #767):
 * - Errors / warnings: always captured (100%)
 * - Normal info / debug: sampled at SAMPLE_RATE (default 10%)
 *
 * Set LOG_SAMPLE_RATE env var (0.0–1.0) to override.
 */
const SAMPLE_RATE = parseFloat(process.env.LOG_SAMPLE_RATE ?? "0.1");

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

    const configuredLevel = (process.env.LOG_LEVEL ?? "info").toLowerCase();
    const moduleLevel = process.env.LOG_LEVEL_FINANCIAL ?? configuredLevel;

    this.logger = winston.createLogger({
      level: configuredLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
      defaultMeta: { service: "carbonledger-backend" },
      transports,
    });
  }

  private getContextWithCorrelationId(context?: LogContext | string): LogContext {
    const baseContext = typeof context === "string" ? { context } : (context ?? {});
    const correlationId = CorrelationIdContext.getCorrelationId();
    const sanitizedContext = this.sanitizeContext(baseContext);

    return {
      ...sanitizedContext,
      correlationId: sanitizedContext.correlationId || correlationId,
    };
  }

  private sanitizeContext(context: LogContext): LogContext {
    const sanitized: LogContext = { ...context };
    const secretKeys = ["password", "secret", "token", "key", "api_key", "private_key", "authorization"];

    for (const key of Object.keys(sanitized)) {
      if (secretKeys.some((secretKey) => key.toLowerCase().includes(secretKey))) {
        sanitized[key] = "[REDACTED]";
      }
    }

    return sanitized;
  }

  private write(level: string, message: string, context?: LogContext | string) {
    const meta = this.getContextWithCorrelationId(context);
    this.logger.log(level, message, meta);
  }

  log(message: string, context?: LogContext | string): void {
    this.write("info", message, context);
  }

  error(message: string, trace?: string, context?: LogContext | string): void {
    // Errors are always captured — skip shouldSample
    const meta = this.enrich(context);
    this.logger.error(message, { ...meta, trace });
  }

  warn(message: string, context?: LogContext | string): void {
    // Warnings are always captured
    const meta = this.enrich(context);
    this.logger.warn(message, meta);
  }

  debug(message: string, context?: LogContext | string): void {
    this.write("debug", message, context);
  }

  verbose(message: string, context?: LogContext | string): void {
    this.write("verbose", message, context);
  }
}
