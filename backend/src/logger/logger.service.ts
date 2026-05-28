import { Injectable, LoggerService as NestLoggerService } from "@nestjs/common";
import * as winston from "winston";
import CloudWatchTransport from "winston-cloudwatch";

export interface LogContext {
  trace_id?: string;
  user_id?: string;
  contract_id?: string;
  [key: string]: unknown;
}

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

  private write(level: string, message: string, context?: LogContext | string) {
    const meta = typeof context === "string" ? { context } : (context ?? {});
    this.logger.log(level, message, meta);
  }

  log(message: string, context?: LogContext | string) {
    this.write("info", message, context);
  }

  error(message: string, trace?: string, context?: LogContext | string) {
    const meta = typeof context === "string" ? { context, trace } : { ...(context ?? {}), trace };
    this.logger.error(message, meta);
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
}
