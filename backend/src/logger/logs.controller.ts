import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { LoggerService } from './logger.service';
import { LogsQueryService, LogEntry } from './logs-query.service';

interface FrontendLogDto {
  level: 'error' | 'warn';
  message: string;
  trace_id?: string;
  user_id?: string;
  contract_id?: string;
  stack?: string;
  url?: string;
  [key: string]: unknown;
}

export interface CorrelationLogsResponse {
  correlationId: string;
  count: number;
  logs: LogEntry[];
}

/**
 * LogsController
 *
 * POST /api/v1/logs         — ingest frontend error/warn logs
 * GET  /api/v1/logs/:id     — retrieve all buffered logs for a correlation ID
 */
@Controller('logs')
export class LogsController {
  constructor(
    private readonly logger: LoggerService,
    private readonly logsQuery: LogsQueryService,
  ) {}

  /** Ingest a structured log entry from the frontend. */
  @Post()
  @HttpCode(204)
  ingest(@Body() body: FrontendLogDto): void {
    const { level, message, stack, ...meta } = body;
    if (level === 'error') {
      this.logger.error(`[frontend] ${message}`, stack, {
        source: 'frontend',
        ...meta,
      });
    } else {
      this.logger.warn(`[frontend] ${message}`, { source: 'frontend', ...meta });
    }
  }

  /**
   * Query all buffered log entries for a given correlation ID.
   *
   * The buffer holds the last LOG_QUERY_BUFFER_SIZE (default: 1000) log lines
   * in memory.  For long-lived traces or production forensics, query your
   * external log aggregator (CloudWatch Insights, Kibana, Grafana Loki) using
   * the same correlationId field.
   *
   * Returns 404 when no logs are found for the supplied ID (either the ID is
   * unknown, or the buffer has wrapped and the entries have been evicted).
   */
  @Get(':correlationId')
  getByCorrelationId(
    @Param('correlationId') correlationId: string,
  ): CorrelationLogsResponse {
    const logs = this.logsQuery.findByCorrelationId(correlationId);

    if (logs.length === 0) {
      throw new NotFoundException(
        `No logs found for correlation ID "${correlationId}". ` +
          'The ID may be unknown, or the buffer may have wrapped. ' +
          'Query your external log aggregator for historical traces.',
      );
    }

    return { correlationId, count: logs.length, logs };
  }
}
