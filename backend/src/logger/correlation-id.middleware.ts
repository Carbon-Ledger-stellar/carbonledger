import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { CorrelationIdContext } from './correlation-id.context';

/**
 * Middleware to generate and propagate correlation IDs across requests.
 * Extracts correlation ID from X-Correlation-ID header or generates a new one.
 * Sets the correlation ID in the response header and stores it in AsyncLocalStorage.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // Extract correlation ID from request header or generate new one
    const correlationId =
      (req.headers['x-correlation-id'] as string) ||
      CorrelationIdContext.generateCorrelationId();

    // Store in request object for access in controllers/services
    (req as any).correlationId = correlationId;

    // Set correlation ID in response header
    res.setHeader('X-Correlation-ID', correlationId);

    // Set correlation context for AsyncLocalStorage
    CorrelationIdContext.setContext({
      correlationId,
      method: req.method,
      path: req.path,
    });

    next();
  }
}
