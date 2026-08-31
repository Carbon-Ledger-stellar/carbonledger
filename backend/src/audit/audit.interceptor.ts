import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { AuditService } from './audit.service';
import { LoggerService } from '../logger/logger.service';
import { consumeAuditBeforeState } from './audit-context';

/**
 * Admin / sensitive routes whose mutations must always be logged regardless
 * of the HTTP method (some GET endpoints like exports count as sensitive ops).
 */
const ADMIN_ACTION_PATTERNS: RegExp[] = [
  /\/admin\//,
  /\/auth\/role/,
  /\/verifiers/,
  /\/audit\//,
  /\/export/,
  /\/retirements/,
];

/**
 * Routes to skip audit logging — health checks, public reads, auth handshakes.
 */
const SKIP_PATTERNS: RegExp[] = [
  /\/auth\/challenge/,
  /\/auth\/refresh/,
  /\/health/,
  /\/metrics/,
];

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private auditService: AuditService,
    @Inject(LoggerService) private readonly logger: LoggerService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, ip, user } = request;

    // Skip non-mutating requests unless they match an admin pattern
    const isAdminRoute   = ADMIN_ACTION_PATTERNS.some(p => p.test(url));
    const isSkippedRoute = SKIP_PATTERNS.some(p => p.test(url));

    if (isSkippedRoute) {
      return next.handle();
    }

    // Always log admin routes; for other routes only log state-changing methods
    const isMutatingMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    if (!isMutatingMethod && !isAdminRoute) {
      return next.handle();
    }

    const action     = `${method} ${url}`;
    const userId     = user?.id || user?.publicKey || 'anonymous';
    const resourceId = body?.id || body?.projectId || body?.batchId || body?.retirementId;

    // Sanitise body — strip sensitive fields before logging
    const sanitisedBody = this.sanitiseBody(body);

    return next.handle().pipe(
      tap((data) => {
        // Consumed here (not before next.handle()) so the snapshot survives
        // long enough for the mutating handler further down the chain to set it.
        const before = consumeAuditBeforeState(request);
        this.auditService.createLog({
          userId,
          action,
          resourceId,
          ipAddress: ip,
          result:    'Success',
          metadata:  {
            method,
            url,
            body:           sanitisedBody,
            responseStatus: 'completed',
            isAdminAction:  isAdminRoute,
          },
        }).catch(err => {
          this.logger.error('Audit log creation failed', err instanceof Error ? err.stack : String(err), {
            userId,
            action,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }),
      catchError((err) => {
        const before = consumeAuditBeforeState(request);
        this.auditService.createLog({
          userId,
          action,
          resourceId,
          ipAddress: ip,
          result:    `Failure: ${err.message || 'Unknown error'}`,
          metadata:  {
            method,
            url,
            body:          sanitisedBody,
            error:         err?.message,
            isAdminAction: isAdminRoute,
          },
        }).catch(logErr => {
          this.logger.error('Audit log creation failed', logErr instanceof Error ? logErr.stack : String(logErr), {
            userId,
            action,
            error: logErr instanceof Error ? logErr.message : String(logErr),
          });
        });
        return throwError(() => err);
      }),
    );
  }

  /**
   * Remove or redact fields that should never appear in audit logs.
   */
  private sanitiseBody(body: any): any {
    if (!body || typeof body !== 'object') return body;

    const REDACT_KEYS = new Set([
      'password', 'secret', 'token', 'privateKey', 'secretKey',
      'signature', 'mnemonic', 'seed', 'apiKey', 'authorization',
    ]);

    return Object.fromEntries(
      Object.entries(body).map(([k, v]) =>
        REDACT_KEYS.has(k.toLowerCase()) ? [k, '[REDACTED]'] : [k, v],
      ),
    );
  }
}
