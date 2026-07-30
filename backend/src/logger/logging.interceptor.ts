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
 * Structured request/response logging interceptor (issue #767).
 *
 * Captures per-request:
 *   - correlationId  (from CorrelationIdContext, set by CorrelationIdMiddleware)
 *   - actor          (publicKey from JWT)
 *   - role           (user role from JWT)
 *   - endpoint       (HTTP method + path)
 *   - statusCode / duration on completion
 *   - error details on failure
 *
 * Sampling is handled inside LoggerService (100% errors, 10% normals).
 */
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

          this.logger.log(`← ${method} ${path} ${statusCode}`, {
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

          // Errors always captured (100% sampling)
          this.logger.error(`✗ ${method} ${path} ${statusCode}`, err.stack, {
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
