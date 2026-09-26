import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { CorrelationIdContext } from './correlation-id.context';
import { getTraceId } from '../telemetry/tracing';

/**
 * Middleware to generate and propagate correlation IDs across requests.
 * Extracts trace ID from OpenTelemetry active span or request headers.
 * Sets the trace ID and correlation ID in response headers and AsyncLocalStorage context.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const traceId = getTraceId();
    const correlationId =
      (req.headers['x-correlation-id'] as string) ||
      (req.headers['x-trace-id'] as string) ||
      (traceId ? traceId : CorrelationIdContext.generateCorrelationId());

    // Attach to request object for downstream access
    (req as any).correlationId = correlationId;
    if (traceId) {
      (req as any).traceId = traceId;
      res.setHeader('X-Trace-ID', traceId);
    }

    // Echo back in response
    res.setHeader('X-Correlation-ID', correlationId);

    // Extract actor context from JWT payload when passport has already parsed it.
    // At middleware execution time passport may not have run yet for protected
    // routes — the interceptor will patch actorId / actorRole after auth.
    const user = (req as any).user as { id?: string; sub?: string; role?: string } | undefined;

    CorrelationIdContext.setContext({
      correlationId,
      traceId: traceId || correlationId,
      method: req.method,
      path: req.path,
      actorId: user?.id ?? user?.sub,
      actorRole: user?.role,
      // Sampling is deferred: shouldSample() makes the decision on first call
    });

    next();
  }
}

