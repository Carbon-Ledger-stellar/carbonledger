import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { STATUS_CODES } from 'http';
import { LoggerService } from '../logger/logger.service';

export interface ErrorResponse {
  statusCode: number;
  error: string;
  code: string;
  message: string;
  [key: string]: unknown;
}

/** Maps common HTTP status codes to a stable, machine-readable error code. */
const STATUS_CODE_MAP: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  410: 'GONE',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  503: 'SERVICE_UNAVAILABLE',
};

function codeForStatus(status: number): string {
  return STATUS_CODE_MAP[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
}

/**
 * Catch-all fallback exception filter (#966).
 *
 * Registered LAST among the app's global filters (see main.ts) so the
 * narrower, purpose-built filters — ValidationExceptionFilter,
 * StellarUnavailableExceptionFilter, ThrottlerExceptionFilter,
 * ResponseAlreadySentFilter — get first refusal on the exception types they
 * already know how to format. NestJS resolves `@Catch()` filters in
 * registration order and stops at the first whose declared type matches
 * (see @nestjs/common's selectExceptionFilterMetadata); this filter's bare
 * `@Catch()` matches *everything*, so it must come last or it would swallow
 * every exception before the specific filters ever ran.
 *
 * What reaches this filter, in practice:
 *  - HttpExceptions the app throws without a dedicated filter (NotFound,
 *    Conflict, Forbidden, UnprocessableEntity, plain BadRequest not produced
 *    by the ValidationPipe, ...)
 *  - Anything unexpected: Prisma errors, network failures, programmer
 *    errors — anything that isn't an HttpException at all.
 *
 * Response shape (both branches) is the CarbonLedger standard error envelope:
 *   { statusCode, error, code, message, ...extra }
 * 4xx responses keep their real, actionable message — it was produced by our
 * own code and is safe to return. 5xx responses are collapsed to a generic
 * message; the real error (with stack) is logged server-side instead of
 * leaked to the caller.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger?: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // A downstream handler (e.g. a guard) may have already written the
    // response directly; nothing left for us to do.
    if (response.headersSent) return;

    const isHttp = exception instanceof HttpException;
    const statusCode = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const reasonPhrase = STATUS_CODES[statusCode] ?? 'Error';

    let body: ErrorResponse;

    if (isHttp) {
      const raw = exception.getResponse();
      const rawObj: Record<string, unknown> = typeof raw === 'string' ? { message: raw } : { ...(raw as object) };

      body = {
        error: reasonPhrase,
        code: codeForStatus(statusCode),
        message: exception.message,
        ...rawObj,
        // Re-assert after the spread: rawObj must never be able to override
        // the actual response status with a stale/forged value.
        statusCode,
      };
    } else {
      body = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred. Please try again or contact support if the problem persists.',
      };
    }

    const exceptionMessage = exception instanceof Error ? exception.message : String(exception);
    const logMessage = `${request?.method ?? ''} ${request?.originalUrl ?? request?.url ?? ''} -> ${body.statusCode}: ${exceptionMessage}`;
    const logContext = { statusCode: body.statusCode, endpoint: request?.originalUrl ?? request?.url };

    if (body.statusCode >= 500) {
      // Unexpected failure — log with full stack for debugging, never sent to the client.
      const stack = exception instanceof Error ? exception.stack : undefined;
      if (this.logger) this.logger.error(logMessage, stack, logContext);
      else console.error('[AllExceptionsFilter]', logMessage, stack);
    } else {
      // Expected client error — worth a lower-severity trail, no stack noise needed.
      if (this.logger) this.logger.warn(logMessage, logContext);
    }

    response.status(body.statusCode).set('Connection', 'keep-alive').json(body);
  }
}
