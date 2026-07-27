import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { CorrelationIdContext } from './correlation-id.context';

/**
 * CorrelationIdMiddleware
 *
 * Runs as Express middleware (registered in AppModule.configure()).
 * Responsibilities:
 *  1. Read X-Correlation-ID from the incoming request header, or generate a new UUID v4.
 *  2. Attach it to `req.correlationId` so controllers/interceptors can read it directly.
 *  3. Echo it back in the X-Correlation-ID response header for client tracing.
 *  4. Seed the AsyncLocalStorage context so that every downstream log call — including
 *     Prisma query middleware, Oracle calls, BullMQ enqueue, etc. — automatically
 *     includes the same correlationId without explicit parameter passing.
 *
 * NOTE: This class must NOT be registered as APP_INTERCEPTOR.  It is an Express
 * middleware and must only be applied via AppModule.configure().
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId =
      (req.headers['x-correlation-id'] as string) ||
      CorrelationIdContext.generateCorrelationId();

    // Make correlationId directly accessible on the request object
    (req as any).correlationId = correlationId;

    // Echo in response so clients can correlate their logs with ours
    res.setHeader('X-Correlation-ID', correlationId);

    // Seed AsyncLocalStorage — everything downstream in this async call chain
    // will read this context via CorrelationIdContext.getContext()
    CorrelationIdContext.setContext({
      correlationId,
      method: req.method,
      path: req.path,
      endpoint: `${req.method} ${req.path}`,
    });

    next();
  }
}
