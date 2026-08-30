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
 * LoggingInterceptor — fires after passport middleware has parsed the JWT,
 * so actorId and actorRole are reliably available here.
 *
 * Per-request it:
 *  1. Patches the AsyncLocalStorage context with actor identity
 *  2. Logs the incoming request (subject to sampling)
 *  3. On completion: logs the outgoing response with duration / status code
 *  4. On error: force-enables sampling and logs the error with full context
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    const correlationId = (req as any).correlationId as string | undefined;
    const method = req.method as string;
    const path   = req.path   as string;

    // Passport has run by now — extract actor fields from JWT payload
    const user     = req.user as { id?: string; sub?: string; role?: string } | undefined;
    const actorId  = user?.id ?? user?.sub;
    const actorRole = user?.role;
    const contractId = (req.headers["x-contract-id"] as string) ?? undefined;

    // Patch correlation context so actorId / actorRole are available to all
    // downstream log calls within this request (oracle, DB helpers, etc.)
    CorrelationIdContext.patchContext({ actorId, actorRole });

    const start = Date.now();

    this.logger.log(`→ ${method} ${path}`, {
      correlationId,
      actorId,
      actorRole,
      contractId,
      ip: req.ip,
    });

    return next.handle().pipe(
      tap({
        next: () => {
          const duration   = Date.now() - start;
          const statusCode = res.statusCode as number;

          CorrelationIdContext.patchContext({ statusCode, duration });

          this.logger.log(`← ${method} ${path} ${statusCode}`, {
            correlationId,
            actorId,
            actorRole,
            contractId,
            statusCode,
            duration,
          });
        },
        error: (err: Error) => {
          const duration   = Date.now() - start;
          const statusCode = (res.statusCode as number) || 500;

          // Errors always emit — forceSample() is called inside logger.error()
          CorrelationIdContext.patchContext({ statusCode, duration });

          this.logger.error(`← ${method} ${path} ${statusCode} ERROR`, err.stack, {
            correlationId,
            actorId,
            actorRole,
            contractId,
            statusCode,
            duration,
            errorMessage: err.message,
          });
        },
      }),
    );
  }
}
