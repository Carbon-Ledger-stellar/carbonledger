import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { AuditService } from './audit.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private auditService: AuditService) {}

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
        }).catch(err => console.error('Audit log failed', err));
      }),
      catchError((err) => {
        this.auditService.createLog({
          userId,
          action,
          resourceId,
          ipAddress: ip,
          result: `Failure: ${err.message || 'Unknown error'}`,
          metadata: { body, error: err },
        }).catch(logErr => console.error('Audit log failed', logErr));
        return throwError(() => err);
      }),
    );
  }
}
