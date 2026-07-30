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

  /**
   * Enrich a log context with the current correlation ID and any
   * actor/role/endpoint fields supplied by the caller.
   */
  private enrich(context?: LogContext | string): LogContext {
    const base = typeof context === "string" ? { context } : (context ?? {});
    const ctx  = CorrelationIdContext.getContext();

    return {
      ...base,
      correlationId: base.correlationId || ctx?.correlationId || "",
      endpoint:      base.endpoint      || ctx?.path,
    };
  }

  /**
   * Deterministic sampling based on the current correlationId.
   * Returns true if the log should be emitted.
   * Errors/warnings always pass through.
   */
  private shouldSample(level: string): boolean {
    if (level === "error" || level === "warn") return true;   // 100%
    if (SAMPLE_RATE >= 1.0) return true;
    if (SAMPLE_RATE <= 0.0) return false;

    // Use the last 4 hex chars of the correlationId as a stable uint16
    const id = CorrelationIdContext.getCorrelationId();
    if (!id) return Math.random() < SAMPLE_RATE;
    const tail = id.replace(/-/g, "").slice(-4);
    const n = parseInt(tail, 16) / 0xffff;
    return n < SAMPLE_RATE;
  }

  private write(level: string, message: string, context?: LogContext | string): void {
    if (!this.shouldSample(level)) return;
    const meta = this.enrich(context);
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
