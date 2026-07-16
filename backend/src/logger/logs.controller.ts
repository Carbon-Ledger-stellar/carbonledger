import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { LoggerService } from "../logger/logger.service";

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

@Controller("logs")
export class LogsController {
  constructor(private readonly logger: LoggerService) {}

  @Post()
  @HttpCode(204)
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
}
