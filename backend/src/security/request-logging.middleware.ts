import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { CorrelationIdContext } from '../logger/correlation-id.context';

export interface RequestLog {
  timestamp: string;
  method: string;
  path: string;
  statusCode?: number;
  durationMs: number;
  userId?: string;
  errorMessage?: string;
  correlationId?: string;
  traceId?: string;
}

/**
 * Request logging middleware that logs all API requests in structured JSON format.
 * Captures: timestamp, method, path, status, duration, user ID (when authenticated), and errors.
 *
 * Logs are written to stdout in JSON format for collection by logging infrastructure.
 *
 * Implements acceptance criteria for Issue #1020:
 * - Logs all requests before response
 * - Includes method, path, status code, duration
 * - Includes user ID when authenticated
 * - Writes to stdout in JSON format
 */
@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const method = req.method;
    const path = req.path;
    const correlationId = CorrelationIdContext.getCorrelationId();
    const traceId = CorrelationIdContext.getTraceId();

    // Extract user ID from JWT if present
    // JWT is typically in req.user after AuthGuard processes it
    const userId = (req as any)?.user?.id || (req as any)?.user?.sub;

    // Intercept response finish to capture status code
    const originalSend = res.send;
    res.send = function (data: any) {
      const durationMs = Date.now() - startTime;
      const statusCode = res.statusCode;

      // Build the log object
      const log: RequestLog = {
        timestamp: new Date().toISOString(),
        method,
        path,
        statusCode,
        durationMs,
      };

      // Add optional fields
      if (userId) {
        log.userId = userId;
      }
      if (correlationId) {
        log.correlationId = correlationId;
      }
      if (traceId) {
        log.traceId = traceId;
      }

      // If there's an error response, capture the error message
      if (statusCode >= 400 && typeof data === 'object') {
        log.errorMessage = data?.message || data?.error || 'Unknown error';
      }

      // Write the structured JSON log to stdout
      process.stdout.write(JSON.stringify(log) + '\n');

      // Call the original send method
      return originalSend.call(this, data);
    };

    next();
  }
}
