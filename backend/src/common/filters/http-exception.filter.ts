import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

export interface StandardErrorResponse {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string; requestId?: string }>();

    const requestId =
      (request?.id as string | undefined) ??
      (request?.requestId as string | undefined) ??
      (request?.headers?.['x-request-id'] as string | undefined);

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const body: StandardErrorResponse = this.buildErrorBody(exception, status);
    if (requestId) {
      body.requestId = requestId;
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request?.method ?? ''} ${request?.url ?? ''} -> ${status} ${body.code}: ${body.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json(body);
  }

  private buildErrorBody(exception: unknown, status: number): StandardErrorResponse {
    if (exception instanceof HttpException) {
      const code = this.resolveCode(exception, status);
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return { code, message: payload };
      }

      if (payload && typeof payload === 'object') {
        const record = payload as Record<string, unknown>;
        const rawMessage = record.message;
        const message = Array.isArray(rawMessage)
          ? rawMessage.join(', ')
          : typeof rawMessage === 'string'
            ? rawMessage
            : exception.message;

        const details =
          record.details !== undefined
            ? record.details
            : Array.isArray(rawMessage)
              ? rawMessage
              : record.error !== undefined
                ? record.error
                : undefined;

        const body: StandardErrorResponse = { code, message };
        if (details !== undefined) {
          body.details = details;
        }
        return body;
      }

      return { code, message: exception.message };
    }

    return {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    };
  }

  private resolveCode(exception: HttpException, status: number): string {
    const payload = exception.getResponse();
    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>;
      if (typeof record.code === 'string' && record.code.length > 0) {
        return record.code;
      }
    }
    return this.defaultCodeForStatus(status);
  }

  private defaultCodeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'BAD_REQUEST';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'UNPROCESSABLE_ENTITY';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'TOO_MANY_REQUESTS';
      case HttpStatus.INTERNAL_SERVER_ERROR:
        return 'INTERNAL_SERVER_ERROR';
      default:
        return `HTTP_${status}`;
    }
  }
}
