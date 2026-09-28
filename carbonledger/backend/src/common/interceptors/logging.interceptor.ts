import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';
import { Logger } from '../logger/logger.service';
import { RequestContextService } from '../context/request-context.service';

/**
 * Structured logging interceptor.
 *
 * - Generates a correlation ID per incoming request (or reuses an inbound one).
 * - Stores actor/role/endpoint in the request context so downstream services
 *   (database queries, oracle calls) can thread the correlation ID through.
 * - Emits structured JSON logs with timestamp, level, message and context.
 * - Applies sampling: 100% for errors, 10% for normal requests.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private static readonly NORMAL_SAMPLE_RATE = 0.1;

  constructor(
    private readonly logger: Logger,
    private readonly requestContext: RequestContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: { id?: string; role?: string } }>();
    const response = http.getResponse<Response>();

    const correlationId =
      (request.headers['x-correlation-id'] as string) || randomUUID();

    const actor = request.user?.id ?? 'anonymous';
    const role = request.user?.role ?? 'anonymous';
    const endpoint = `${request.method} ${request.originalUrl ?? request.url}`;

    response.setHeader('x-correlation-id', correlationId);

    const startedAt = Date.now();

    return new Observable((subscriber) => {
      this.requestContext.run(
        { correlationId, actor, role, endpoint },
        () => {
          const subscription = next.handle().subscribe({
            next: (value) => subscriber.next(value),
            error: (err) => {
              this.logRequest(correlationId, actor, role, endpoint, response.statusCode || 500, startedAt, err);
              subscriber.error(err);
            },
            complete: () => {
              this.logRequest(correlationId, actor, role, endpoint, response.statusCode, startedAt);
              subscriber.complete();
            },
          });

          return () => subscription.unsubscribe();
        },
      );
    });
  }

  private logRequest(
    correlationId: string,
    actor: string,
    role: string,
    endpoint: string,
    statusCode: number,
    startedAt: number,
    error?: unknown,
  ): void {
    const durationMs = Date.now() - startedAt;
    const isError = Boolean(error) || statusCode >= 500;

    if (!isError && Math.random() >= LoggingInterceptor.NORMAL_SAMPLE_RATE) {
      return;
    }

    const context = {
      correlationId,
      actor,
      role,
      endpoint,
      statusCode,
      durationMs,
    };

    if (isError) {
      this.logger.error('Request failed', error instanceof Error ? error.stack : String(error), context);
    } else {
      this.logger.log('Request completed', context);
    }
  }
}
