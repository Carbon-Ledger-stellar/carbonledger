import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  correlationId: string;
  actor?: string;
  role?: string;
  endpoint: string;
  method: string;
  startedAt: number;
}

/**
 * AsyncLocalStorage holding the per-request context so that the correlation ID
 * (and actor/role/endpoint) can be threaded through all logs, database queries
 * and oracle calls without passing it explicitly through every call site.
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function getCorrelationId(): string | undefined {
  return requestContextStorage.getStore()?.correlationId;
}

const CORRELATION_ID_HEADER = 'x-correlation-id';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[CORRELATION_ID_HEADER];
    const correlationId =
      (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();

    const context: RequestContext = {
      correlationId,
      actor: (req as any).user?.id ?? (req as any).user?.sub,
      role: (req as any).user?.role,
      endpoint: req.originalUrl ?? req.url,
      method: req.method,
      startedAt: Date.now(),
    };

    // Echo the correlation ID back so clients and downstream services can trace.
    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    requestContextStorage.run(context, () => next());
  }
}
