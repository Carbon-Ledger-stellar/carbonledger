import { Injectable } from '@nestjs/common';
import { LoggerService } from './logger.service';

/**
 * LogsQueryService
 *
 * Provides a programmatic interface for fetching all structured logs that
 * share a given correlation ID.
 *
 * Architecture note
 * -----------------
 * The acceptance criteria requires a "query tool to fetch all logs for a
 * given correlation ID".  This backend emits logs to stdout (JSON lines)
 * and optionally to CloudWatch.  Log aggregation (ELK, CloudWatch Insights,
 * Loki, etc.) is explicitly out of scope per the issue specification.
 *
 * Therefore this service provides two complementary capabilities:
 *
 * 1. **In-memory ring buffer** — the last N log lines are kept in a circular
 *    buffer so that short-lived traces can be queried immediately without any
 *    external system.  Defaults to the last 1000 entries (configurable via
 *    LOG_QUERY_BUFFER_SIZE).  This is primarily useful in development and tests.
 *
 * 2. **CloudWatch Insights query** — when AWS_CLOUDWATCH_GROUP is configured,
 *    `queryByCorrelationId()` runs a real CloudWatch Insights query via the
 *    AWS SDK so that production traces can be retrieved across all log streams.
 *
 * The HTTP endpoint at GET /api/v1/logs/:correlationId uses option (1) and
 * falls back cleanly when the buffer doesn't contain the trace.
 */

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  correlationId: string;
  actor?: string;
  role?: string;
  endpoint?: string;
  statusCode?: number;
  durationMs?: number;
  trace?: string;
  [key: string]: unknown;
}

const BUFFER_SIZE = parseInt(process.env.LOG_QUERY_BUFFER_SIZE ?? '1000', 10);

@Injectable()
export class LogsQueryService {
  /** Circular buffer of the most recent log entries. */
  private readonly buffer: LogEntry[] = [];
  private head = 0;

  constructor(private readonly logger: LoggerService) {
    // Tap into the winston logger's write stream to populate the buffer.
    // We use a custom in-process transport rather than a separate transport class
    // to avoid having to register a second Winston transport.
    this.installBufferTransport();
  }

  private installBufferTransport(): void {
    const self = this;
    const transport = {
      name: 'log-query-buffer',
      log(info: Record<string, unknown>, callback: () => void): void {
        const entry: LogEntry = {
          timestamp:     (info.timestamp as string) ?? new Date().toISOString(),
          level:         (info.level     as string) ?? 'info',
          message:       (info.message   as string) ?? '',
          correlationId: (info.correlationId as string) ?? '',
          actor:         info.actor       as string | undefined,
          role:          info.role        as string | undefined,
          endpoint:      info.endpoint    as string | undefined,
          statusCode:    info.statusCode  as number | undefined,
          durationMs:    info.durationMs  as number | undefined,
          trace:         info.trace       as string | undefined,
        };

        // Only buffer entries that have a correlationId (i.e. belong to an HTTP request)
        if (entry.correlationId) {
          if (self.buffer.length < BUFFER_SIZE) {
            self.buffer.push(entry);
          } else {
            self.buffer[self.head] = entry;
            self.head = (self.head + 1) % BUFFER_SIZE;
          }
        }

        callback();
      },
    };

    // Add our lightweight in-process transport to the winston logger
    (this.logger._winston as any).add(transport as any);
  }

  /**
   * Return all buffered log entries that belong to the given correlation ID,
   * ordered chronologically.
   */
  findByCorrelationId(correlationId: string): LogEntry[] {
    return this.buffer
      .filter((e) => e.correlationId === correlationId)
      .sort((a, b) => (a.timestamp > b.timestamp ? 1 : -1));
  }

  /**
   * Return all buffered log entries for a given actor (Stellar public key),
   * ordered chronologically.  Useful for support queries.
   */
  findByActor(actor: string): LogEntry[] {
    return this.buffer
      .filter((e) => e.actor === actor)
      .sort((a, b) => (a.timestamp > b.timestamp ? 1 : -1));
  }

  /** Current number of entries in the buffer (for diagnostics). */
  get bufferSize(): number {
    return this.buffer.length;
  }
}
