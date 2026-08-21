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
    const req         = context.switchToHttp().getRequest();
    const res         = context.switchToHttp().getResponse();
    const method      = req.method as string;
    const path        = req.path  as string;
    const correlationId = (req as any).correlationId as string | undefined;

    // Domain context from JWT payload (attached by passport/roles guard)
    const user     = req.user as { id?: string; publicKey?: string; role?: string } | undefined;
    const actor    = user?.publicKey ?? user?.id;
    const role     = user?.role;
    const contractId = (req.headers["x-contract-id"] as string) ?? undefined;

    const start = Date.now();

    this.logger.log(`→ ${method} ${path}`, {
      correlationId,
      actor,
      role,
      endpoint:    `${method} ${path}`,
      contract_id: contractId,
      ip:          req.ip,
    });

    return next.handle().pipe(
      tap({
        next: () => {
          const duration   = Date.now() - start;
          const statusCode = res.statusCode as number;

          // Update context so downstream code/logs see the final status
          CorrelationIdContext.setContext({
            correlationId: correlationId ?? "",
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
              user_id: actor,
              contract_id: contractId,
              statusCode,
              duration,
              threshold_ms: SLOW_QUERY_THRESHOLD_MS,
              event: "SLOW_QUERY",
            });
          }

          // Log successful response with structured fields
          this.logger.log(`${method} ${path} completed`, {
            correlationId,
            actor,
            role,
            endpoint:    `${method} ${path}`,
            contract_id: contractId,
            statusCode,
            duration,
          });
        },
        error: (err: Error) => {
          const duration   = Date.now() - start;
          const statusCode = (res.statusCode as number) || 500;

          CorrelationIdContext.setContext({
            correlationId: correlationId ?? "",
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
              user_id: actor,
              contract_id: contractId,
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
            actor,
            role,
            endpoint:    `${method} ${path}`,
            contract_id: contractId,
            statusCode,
            duration,
            error:       err.message,
          });
        },
      }),
    );
  }
}
