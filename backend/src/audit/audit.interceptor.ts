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

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private auditService: AuditService,
    @Inject(LoggerService) private readonly logger: LoggerService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, ip, user } = request;

    // Only log state-changing operations
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }

    // Skip specific routes if needed (e.g., auth, health)
    if (url.includes('/auth/') || url.includes('/health')) {
      return next.handle();
    }

    const action = `${method} ${url}`;
    const userId = user?.id || user?.publicKey || 'anonymous';
    const resourceId = body?.id || body?.projectId || body?.batchId || body?.retirementId;

    return next.handle().pipe(
      tap((data) => {
        this.auditService.createLog({
          userId,
          action,
          resourceId,
          ipAddress: ip,
          result: 'Success',
          metadata: { body, responseStatus: 'completed' },
        }).catch(err => {
          this.logger.error('Audit log creation failed', err instanceof Error ? err.stack : String(err), {
            userId,
            action,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }),
      catchError((err) => {
        this.auditService.createLog({
          userId,
          action,
          resourceId,
          ipAddress: ip,
          result: `Failure: ${err.message || 'Unknown error'}`,
          metadata: { body, error: err },
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
}
