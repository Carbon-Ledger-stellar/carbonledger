import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';
import { LoggerService } from '../logger/logger.service';
import { captureAuditBeforeState } from './audit-context';

/**
 * Covers the before/after state capture added for #963 — "Before/after
 * state recorded" was previously unmet: the interceptor only logged the
 * raw request body, never the entity's prior state.
 */
describe('AuditInterceptor — before/after state (#963)', () => {
  let auditService: { createLog: jest.Mock };
  let logger: LoggerService;
  let interceptor: AuditInterceptor;

  beforeEach(() => {
    auditService = { createLog: jest.fn().mockResolvedValue(undefined) };
    logger = { error: jest.fn() } as unknown as LoggerService;
    interceptor = new AuditInterceptor(auditService as unknown as AuditService, logger);
  });

  function makeContext(request: any): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  function makeHandler(result: unknown): CallHandler {
    return { handle: () => of(result) } as CallHandler;
  }

  it('logs before: undefined when the route never captured a snapshot', (done) => {
    const request = { method: 'PATCH', url: '/api/v1/projects/p1/status', body: { status: 'Verified' }, ip: '127.0.0.1', user: { publicKey: 'admin-1' } };
    const context = makeContext(request);

    interceptor.intercept(context, makeHandler({ projectId: 'p1', status: 'Verified' })).subscribe(() => {
      expect(auditService.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ before: undefined, after: { projectId: 'p1', status: 'Verified' } }),
        }),
      );
      done();
    });
  });

  it('captures the pre-mutation snapshot set via captureAuditBeforeState', (done) => {
    const request = { method: 'PATCH', url: '/api/v1/projects/p1/status', body: { status: 'Verified' }, ip: '127.0.0.1', user: { publicKey: 'admin-1' } };
    const priorState = { projectId: 'p1', status: 'Pending' };
    captureAuditBeforeState(request as any, priorState);

    const context = makeContext(request);
    const updated = { projectId: 'p1', status: 'Verified' };

    interceptor.intercept(context, makeHandler(updated)).subscribe(() => {
      expect(auditService.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ before: priorState, after: updated }),
        }),
      );
      done();
    });
  });

  it('clears the captured snapshot after logging so it cannot leak into the next request', (done) => {
    const request: any = { method: 'PATCH', url: '/api/v1/projects/p1/status', body: {}, ip: '127.0.0.1', user: { publicKey: 'admin-1' } };
    captureAuditBeforeState(request, { projectId: 'p1', status: 'Pending' });
    const context = makeContext(request);

    interceptor.intercept(context, makeHandler({ ok: true })).subscribe(() => {
      expect(request.__auditBeforeState).toBeUndefined();
      done();
    });
  });

  it('still includes the before snapshot when the mutation fails', (done) => {
    const request: any = { method: 'PATCH', url: '/api/v1/projects/p1/status', body: {}, ip: '127.0.0.1', user: { publicKey: 'admin-1' } };
    const priorState = { projectId: 'p1', status: 'Pending' };
    captureAuditBeforeState(request, priorState);
    const context = makeContext(request);
    const handler = { handle: () => throwError(() => new Error('transition rejected')) } as CallHandler;

    interceptor.intercept(context, handler).subscribe({
      error: () => {
        expect(auditService.createLog).toHaveBeenCalledWith(
          expect.objectContaining({
            result: expect.stringContaining('transition rejected'),
            metadata: expect.objectContaining({ before: priorState }),
          }),
        );
        done();
      },
    });
  });
});
