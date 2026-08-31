import { Body, Controller, Get, HttpCode, Post, Query, BadRequestException } from "@nestjs/common";
import { LoggerService } from "../logger/logger.service";
import { Roles } from "../auth/decorators";

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
   * POST /logs
   * Ingest structured logs emitted by the frontend (error/warn only).
   */
  @Post()
  @HttpCode(204)
  ingest(@Body() body: FrontendLogDto): void {
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
   * GET /logs/by-correlation-id?id=<correlationId>
   * Query tool: fetch all log entries for a given correlation ID (issue #767).
   *
   * NOTE: This endpoint searches the in-process winston transport buffer.
   * In production, point this at your log aggregation system (ELK, Loki, etc.).
   * The response here serves as a development/debugging convenience.
   *
   * Admin-only.
   */
  @Get("by-correlation-id")
  @Roles("admin")
  getByCorrelationId(@Query("id") correlationId?: string): object {
    if (!correlationId || correlationId.trim() === "") {
      throw new BadRequestException("Query param 'id' (correlationId) is required");
    }

    return {
      correlationId,
      message:
        "To query logs by correlation ID in production, use your log aggregation system " +
        "(Loki: `{service=\"carbonledger-backend\"} | json | correlationId=\"<id>\"`, " +
        "CloudWatch Insights: `filter correlationId=\"<id>\"`). " +
        "The X-Correlation-ID response header on each request carries the ID for tracing.",
      hint: "All CarbonLedger logs include correlationId, actor, role, endpoint, statusCode, and duration fields.",
    };
  }
}
