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

    // Store in request object for access in controllers/services
    (req as any).correlationId = correlationId;
    if (traceId) {
      (req as any).traceId = traceId;
      res.setHeader('X-Trace-ID', traceId);
    }

    // Set correlation ID in response header
    res.setHeader('X-Correlation-ID', correlationId);

    // Set correlation context for AsyncLocalStorage
    CorrelationIdContext.setContext({
      correlationId,
      traceId: traceId || correlationId,
      method: req.method,
      path: req.path,
    });

    next();
  }
}

