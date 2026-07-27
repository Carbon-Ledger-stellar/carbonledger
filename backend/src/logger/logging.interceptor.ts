import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { LoggerService } from './logger.service';
import { CorrelationIdContext } from './correlation-id.context';

/**
 * LoggingInterceptor
 *
 * Records structured logs for every HTTP request/response cycle:
 *   - Incoming: method, path, correlationId, actor (Stellar pubkey), role, ip
 *   - Outgoing: statusCode, durationMs, actor, role
 *   - Errors:   statusCode, durationMs, error.message, stack
 *
 * Additionally enriches the AsyncLocalStorage context with actor and role
 * from the JWT payload (attached by Passport) so all downstream log calls
 * automatically include those fields without explicit passing.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req  = context.switchToHttp().getRequest();
    const res  = context.switchToHttp().getResponse();

    const correlationId: string = (req as any).correlationId ?? CorrelationIdContext.getCorrelationId();
    const method: string        = req.method;
    const path: string          = req.path;
    const endpoint              = `${method} ${path}`;
    const ip: string            = req.ip ?? req.headers['x-forwarded-for'] ?? 'unknown';

    // Extract actor/role from JWT payload (attached by JwtAuthGuard / Passport)
    const user = req.user as { publicKey?: string; sub?: string; role?: string } | undefined;
    const actor = user?.publicKey ?? user?.sub ?? undefined;
    const role  = user?.role ?? undefined;

    // Enrich the AsyncLocalStorage context so every downstream logger call
    // (Prisma middleware, service methods, oracle calls) automatically includes
    // actor, role, and endpoint without explicit passing.
    CorrelationIdContext.enrichContext({ actor, role, endpoint });

    const start = Date.now();

    this.logger.log(`${endpoint} →`, {
      correlationId,
      actor,
      role,
      endpoint,
      ip,
    });

    return next.handle().pipe(
      tap({
        next: () => {
          const durationMs  = Date.now() - start;
          const statusCode: number = res.statusCode;

          CorrelationIdContext.enrichContext({ statusCode, duration: durationMs });

          this.logger.log(`${endpoint} ← ${statusCode}`, {
            correlationId,
            actor,
            role,
            endpoint,
            statusCode,
            durationMs,
          });
        },
        error: (err: Error & { status?: number }) => {
          const durationMs  = Date.now() - start;
          const statusCode: number = err.status ?? res.statusCode ?? 500;

          CorrelationIdContext.enrichContext({ statusCode, duration: durationMs });

          this.logger.error(`${endpoint} ← ${statusCode} ERROR`, err.stack, {
            correlationId,
            actor,
            role,
            endpoint,
            statusCode,
            durationMs,
            error: err.message,
          });
        },
      }),
    );
  }
}
