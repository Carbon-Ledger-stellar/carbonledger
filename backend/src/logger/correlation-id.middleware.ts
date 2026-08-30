import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { CorrelationIdContext } from './correlation-id.context';

/**
 * Middleware to generate and propagate correlation IDs across requests.
 *
 * Per-request it:
 *  1. Extracts or generates a correlation ID (from X-Correlation-ID header)
 *  2. Seeds the AsyncLocalStorage context with the correlation ID, HTTP method,
 *     path, actor ID and role (extracted from the parsed JWT when present)
 *  3. Makes the initial sampling decision (10% normal; 100% error — upgraded
 *     later by the logging interceptor when an error is detected)
 *  4. Sets X-Correlation-ID on the response so clients can correlate
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId =
      (req.headers['x-correlation-id'] as string) ||
      CorrelationIdContext.generateCorrelationId();

    // Attach to request object for downstream access
    (req as any).correlationId = correlationId;

    // Echo back in response
    res.setHeader('X-Correlation-ID', correlationId);

    // Extract actor context from JWT payload when passport has already parsed it.
    // At middleware execution time passport may not have run yet for protected
    // routes — the interceptor will patch actorId / actorRole after auth.
    const user = (req as any).user as { id?: string; sub?: string; role?: string } | undefined;

    CorrelationIdContext.setContext({
      correlationId,
      method: req.method,
      path: req.path,
      actorId: user?.id ?? user?.sub,
      actorRole: user?.role,
      // Sampling is deferred: shouldSample() makes the decision on first call
    });

    next();
  }
}
