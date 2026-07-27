/**
 * Tests for LoggingInterceptor — correlation ID threading through HTTP lifecycle.
 *
 * Covers:
 *  - correlationId propagated from req into log calls
 *  - actor and role extracted from JWT payload and added to logs
 *  - endpoint enrichment in AsyncLocalStorage context
 *  - Error path logs the error message and stack
 *  - Context is enriched with statusCode and durationMs after response
 */

import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';
import { LoggerService, LogContext } from './logger.service';
import { CorrelationIdContext } from './correlation-id.context';

// ── Mock LoggerService ────────────────────────────────────────────────────

const mockLogger = {
  log:   jest.fn(),
  error: jest.fn(),
  warn:  jest.fn(),
  debug: jest.fn(),
  getCorrelationId: jest.fn().mockReturnValue(''),
  setRequestActor:  jest.fn(),
};

// ── Helpers ────────────────────────────────────────────────────────────────

function makeContext(overrides: {
  method?: string;
  path?: string;
  correlationId?: string;
  user?: Record<string, string>;
  ip?: string;
} = {}): ExecutionContext {
  const req = {
    method:        overrides.method        ?? 'GET',
    path:          overrides.path          ?? '/api/v1/health',
    correlationId: overrides.correlationId ?? 'corr-abc-123',
    user:          overrides.user          ?? { publicKey: 'GABC', role: 'admin' },
    ip:            overrides.ip            ?? '127.0.0.1',
    headers:       {},
  };
  const res = { statusCode: 200 };

  return {
    switchToHttp: () => ({
      getRequest:  () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

function makeHandler(value?: unknown): CallHandler {
  return { handle: () => of(value ?? { ok: true }) };
}

function makeErrorHandler(err: Error): CallHandler {
  return { handle: () => throwError(() => err) };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;

  beforeEach(() => {
    jest.clearAllMocks();
    interceptor = new LoggingInterceptor(mockLogger as unknown as LoggerService);
  });

  describe('request logging', () => {
    it('logs the incoming request with method and path', (done) => {
      const ctx = makeContext({ method: 'POST', path: '/api/v1/credits/mint' });

      interceptor.intercept(ctx, makeHandler()).subscribe({
        complete: () => {
          expect(mockLogger.log).toHaveBeenCalledWith(
            expect.stringContaining('POST /api/v1/credits/mint'),
            expect.any(Object),
          );
          done();
        },
      });
    });

    it('includes correlationId in the incoming request log', (done) => {
      const ctx = makeContext({ correlationId: 'test-corr-xyz' });

      interceptor.intercept(ctx, makeHandler()).subscribe({
        complete: () => {
          const [, logContext] = mockLogger.log.mock.calls[0] as [string, LogContext];
          expect(logContext.correlationId).toBe('test-corr-xyz');
          done();
        },
      });
    });

    it('includes actor from JWT payload', (done) => {
      const ctx = makeContext({ user: { publicKey: 'GDEV12345', role: 'project_developer' } });

      interceptor.intercept(ctx, makeHandler()).subscribe({
        complete: () => {
          const [, logContext] = mockLogger.log.mock.calls[0] as [string, LogContext];
          expect(logContext.actor).toBe('GDEV12345');
          done();
        },
      });
    });

    it('includes role from JWT payload', (done) => {
      const ctx = makeContext({ user: { publicKey: 'GCORP', role: 'corporation' } });

      interceptor.intercept(ctx, makeHandler()).subscribe({
        complete: () => {
          const [, logContext] = mockLogger.log.mock.calls[0] as [string, LogContext];
          expect(logContext.role).toBe('corporation');
          done();
        },
      });
    });

    it('includes ip in the incoming request log', (done) => {
      const ctx = makeContext({ ip: '10.0.0.1' });

      interceptor.intercept(ctx, makeHandler()).subscribe({
        complete: () => {
          const [, logContext] = mockLogger.log.mock.calls[0] as [string, LogContext];
          expect(logContext.ip).toBe('10.0.0.1');
          done();
        },
      });
    });
  });

  describe('response logging', () => {
    it('logs completion with statusCode and durationMs', (done) => {
      const ctx = makeContext();

      interceptor.intercept(ctx, makeHandler()).subscribe({
        complete: () => {
          // Second log call is the completion log
          expect(mockLogger.log).toHaveBeenCalledTimes(2);
          const [, completionCtx] = mockLogger.log.mock.calls[1] as [string, LogContext];
          expect(completionCtx.statusCode).toBe(200);
          expect(typeof completionCtx.durationMs).toBe('number');
          expect((completionCtx.durationMs as number) >= 0).toBe(true);
          done();
        },
      });
    });

    it('completion log includes correlationId', (done) => {
      const ctx = makeContext({ correlationId: 'resp-corr-id' });

      interceptor.intercept(ctx, makeHandler()).subscribe({
        complete: () => {
          const [, completionCtx] = mockLogger.log.mock.calls[1] as [string, LogContext];
          expect(completionCtx.correlationId).toBe('resp-corr-id');
          done();
        },
      });
    });

    it('enriches AsyncLocalStorage context with statusCode after response', (done) => {
      CorrelationIdContext.run({ correlationId: 'als-test' }, () => {
        const ctx = makeContext({ correlationId: 'als-test' });

        interceptor.intercept(ctx, makeHandler()).subscribe({
          complete: () => {
            const store = CorrelationIdContext.getContext();
            expect(store?.statusCode).toBe(200);
            expect(typeof store?.duration).toBe('number');
            done();
          },
        });
      });
    });
  });

  describe('error logging', () => {
    it('calls logger.error on handler failure', (done) => {
      const err = new Error('Something exploded');
      const ctx = makeContext();

      interceptor.intercept(ctx, makeErrorHandler(err)).subscribe({
        error: () => {
          expect(mockLogger.error).toHaveBeenCalledWith(
            expect.stringContaining('ERROR'),
            err.stack,
            expect.any(Object),
          );
          done();
        },
      });
    });

    it('error log includes correlationId', (done) => {
      const err = new Error('boom');
      const ctx = makeContext({ correlationId: 'err-corr' });

      interceptor.intercept(ctx, makeErrorHandler(err)).subscribe({
        error: () => {
          const [, , errCtx] = mockLogger.error.mock.calls[0] as [string, string, LogContext];
          expect(errCtx.correlationId).toBe('err-corr');
          done();
        },
      });
    });

    it('error log includes error.message', (done) => {
      const err = new Error('timeout');
      const ctx = makeContext();

      interceptor.intercept(ctx, makeErrorHandler(err)).subscribe({
        error: () => {
          const [, , errCtx] = mockLogger.error.mock.calls[0] as [string, string, LogContext];
          expect(errCtx.error).toBe('timeout');
          done();
        },
      });
    });

    it('error log includes actor and role', (done) => {
      const err = new Error('forbidden');
      (err as any).status = 403;
      const ctx = makeContext({ user: { publicKey: 'GVERIFIER', role: 'verifier' } });

      interceptor.intercept(ctx, makeErrorHandler(err)).subscribe({
        error: () => {
          const [, , errCtx] = mockLogger.error.mock.calls[0] as [string, string, LogContext];
          expect(errCtx.actor).toBe('GVERIFIER');
          expect(errCtx.role).toBe('verifier');
          done();
        },
      });
    });
  });

  describe('endpoint enrichment in AsyncLocalStorage', () => {
    it('enriches context with endpoint label', (done) => {
      CorrelationIdContext.run({ correlationId: 'endpoint-test' }, () => {
        const ctx = makeContext({ method: 'POST', path: '/api/v1/retirements' });

        interceptor.intercept(ctx, makeHandler()).subscribe({
          complete: () => {
            const store = CorrelationIdContext.getContext();
            expect(store?.endpoint).toBe('POST /api/v1/retirements');
            done();
          },
        });
      });
    });
  });
});
