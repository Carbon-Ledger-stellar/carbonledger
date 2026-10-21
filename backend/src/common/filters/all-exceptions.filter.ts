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
  requestId: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string; requestId?: string }>();

    const requestId =
      (request.requestId as string | undefined) ??
      (request.id as string | undefined) ??
      (request.headers['x-request-id'] as string | undefined) ??
      '';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (exceptionResponse && typeof exceptionResponse === 'object') {
        const body = exceptionResponse as Record<string, unknown>;
        if (typeof body.code === 'string') {
          code = body.code;
        } else {
          code = this.codeFromStatus(status);
        }
        if (typeof body.message === 'string') {
          message = body.message;
        } else if (Array.isArray(body.message)) {
          message = body.message.join(', ');
          details = body.message;
        }
        if (body.details !== undefined) {
          details = body.details;
        }
      } else {
        code = this.codeFromStatus(status);
      }
    } else if (exception instanceof Error) {
      message = exception.message || message;
      this.logger.error(exception.message, exception.stack);
    } else {
      this.logger.error('Unhandled exception', String(exception));
    }

    const payload: StandardErrorResponse = {
      code,
      message,
      details,
      requestId,
    };

    response.status(status).json(payload);
  }

  private codeFromStatus(status: number): string {
    const name = HttpStatus[status];
    return typeof name === 'string' ? name : 'INTERNAL_SERVER_ERROR';
  }
}
