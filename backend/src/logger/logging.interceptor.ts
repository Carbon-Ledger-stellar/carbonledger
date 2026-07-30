import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { LoggerService } from "../logger/logger.service";
import { CorrelationIdContext } from "./correlation-id.context";

/**
 * Requests exceeding this duration (ms) are logged at WARN level with a
 * SLOW_QUERY tag so they can be filtered in Grafana / CloudWatch.
 *
 * Configurable via the SLOW_QUERY_THRESHOLD_MS environment variable.
 * Default: 500 ms.  Set to 0 to warn on every request; omit / set very high
 * to effectively disable slow-request detection.
 */
const SLOW_QUERY_THRESHOLD_MS = parseInt(
  process.env.SLOW_QUERY_THRESHOLD_MS ?? "500",
  10,
);

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    const correlationId = (req as any).correlationId;
    const method = req.method;
    const path = req.path;

    // Extract domain context from JWT payload (attached by passport)
    const user = req.user as { id?: string } | undefined;
    const user_id = user?.id;
    const contract_id = (req.headers["x-contract-id"] as string) ?? undefined;

    const start = Date.now();

    // Log incoming request
    this.logger.log(`${method} ${path}`, {
      correlationId,
      user_id,
      contract_id,
      ip: req.ip,
    });

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - start;
          const statusCode = res.statusCode;

          // Update correlation context with response details
          CorrelationIdContext.setContext({
            correlationId,
            method,
            path,
            statusCode,
            duration,
          });

          // Emit a structured warning for slow requests so they can be
          // filtered independently from normal traffic in log aggregation.
          if (duration >= SLOW_QUERY_THRESHOLD_MS) {
            this.logger.warn(`SLOW_QUERY ${method} ${path} exceeded ${SLOW_QUERY_THRESHOLD_MS}ms threshold`, {
              correlationId,
              user_id,
              contract_id,
              statusCode,
              duration,
              threshold_ms: SLOW_QUERY_THRESHOLD_MS,
              event: "SLOW_QUERY",
            });
          }

          // Log successful response with structured fields
          this.logger.log(`${method} ${path} completed`, {
            correlationId,
            user_id,
            contract_id,
            statusCode,
            duration,
          });
        },
        error: (err: Error) => {
          const duration = Date.now() - start;
          const statusCode = res.statusCode || 500;

          // Update correlation context with error details
          CorrelationIdContext.setContext({
            correlationId,
            method,
            path,
            statusCode,
            duration,
          });

          // Emit slow-request warning even on error paths — a timeout that
          // eventually errors is still a slow request worth alerting on.
          if (duration >= SLOW_QUERY_THRESHOLD_MS) {
            this.logger.warn(`SLOW_QUERY ${method} ${path} exceeded ${SLOW_QUERY_THRESHOLD_MS}ms threshold (error)`, {
              correlationId,
              user_id,
              contract_id,
              statusCode,
              duration,
              threshold_ms: SLOW_QUERY_THRESHOLD_MS,
              event: "SLOW_QUERY",
              error: err.message,
            });
          }

          // Log error with structured fields
          this.logger.error(`${method} ${path} failed`, err.stack, {
            correlationId,
            user_id,
            contract_id,
            statusCode,
            duration,
            error: err.message,
          });
        },
      }),
    );
  }
}
