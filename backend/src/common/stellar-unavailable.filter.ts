import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { StellarUnavailableException } from './stellar-unavailable.exception';

@Catch(StellarUnavailableException)
export class StellarUnavailableExceptionFilter implements ExceptionFilter {
  catch(exception: StellarUnavailableException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (!response.headersSent) {
      const raw = exception.getResponse();
      const body = typeof raw === 'string' ? { message: raw } : raw;
      response
        .status(HttpStatus.SERVICE_UNAVAILABLE)
        .set('Connection', 'keep-alive')
        .set('Retry-After', '30')
        .json({ error: 'Service Unavailable', code: 'SERVICE_UNAVAILABLE', ...body, statusCode: HttpStatus.SERVICE_UNAVAILABLE });
    }
  }
}
