import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { LoggerService } from "../logger/logger.service";
import { CorrelationIdContext } from "./correlation-id.context";

interface FrontendLogDto {
  level: "error" | "warn";
  message: string;
  trace_id?: string;
  user_id?: string;
  contract_id?: string;
  stack?: string;
  url?: string;
  [key: string]: unknown;
}

/**
 * LogsController
 *
 * Provides:
 *  - POST /logs          — frontend error ingestion
 *  - GET  /logs/search   — query tool to fetch logs by correlationId
 *                          (intended for local dev / ops tooling; in prod
 *                           this role is filled by Loki/CloudWatch)
 */
@ApiTags("Logs")
@Controller("logs")
export class LogsController {
  constructor(private readonly logger: LoggerService) {}

  /**
   * Ingest a structured log entry from the frontend.
   * Only error and warn levels are accepted from clients.
   */
  @Post()
  @HttpCode(204)
  @ApiOperation({ summary: "Ingest a structured log from the frontend" })
  ingest(@Body() body: FrontendLogDto) {
    const { level, message, stack, ...meta } = body;
    if (level === "error") {
      this.logger.error(`[frontend] ${message}`, stack, {
        source: "frontend",
        ...meta,
      });
    } else {
      this.logger.warn(`[frontend] ${message}`, { source: "frontend", ...meta });
    }
  }

  /**
   * GET /logs/search?correlationId=<id>
   *
   * Returns the correlation context stored in the current request's
   * AsyncLocalStorage — primarily useful in integration tests and local
   * development to verify that a correlationId is correctly threaded.
   *
   * In production, send this correlationId as a filter query to your
   * log aggregation system (Loki: `{app="backend"} | json | correlationId="<id>"`,
   * CloudWatch Insights: `fields @message | filter correlationId = "<id>"`).
   */
  @Get("search")
  @ApiOperation({
    summary: "Query correlation context for the current request",
    description:
      "Returns the correlation context from AsyncLocalStorage for the active request. " +
      "In production, use your log aggregation backend (Loki / CloudWatch) to query " +
      'by correlationId. Example Loki query: `{app="backend"} | json | correlationId="<id>"`',
  })
  @ApiQuery({ name: "correlationId", required: false, description: "Correlation ID to look up" })
  @ApiResponse({
    status: 200,
    description: "Active correlation context for this request",
    schema: {
      example: {
        correlationId: "550e8400-e29b-41d4-a716-446655440000",
        method: "GET",
        path: "/logs/search",
        actorId: "usr_123",
        actorRole: "admin",
        sampled: true,
        lokiQuery: '{app="backend"} | json | correlationId="550e8400-e29b-41d4-a716-446655440000"',
        cloudWatchQuery: 'fields @message | filter correlationId = "550e8400-e29b-41d4-a716-446655440000"',
      },
    },
  })
  searchByCorrelationId(@Query("correlationId") correlationId?: string) {
    const ctx = CorrelationIdContext.getContext();
    const activeId = correlationId ?? ctx?.correlationId ?? CorrelationIdContext.getCorrelationId();

    return {
      correlationId: activeId,
      activeContext: ctx ?? null,
      // Aggregation query hints for external log backends
      lokiQuery: activeId
        ? `{app="backend"} | json | correlationId="${activeId}"`
        : null,
      cloudWatchQuery: activeId
        ? `fields @timestamp, @message | filter correlationId = "${activeId}" | sort @timestamp asc`
        : null,
      note:
        "For full log history, query your log aggregation backend " +
        "(Loki, CloudWatch Insights, or ELK) using the queries above.",
    };
  }
}
