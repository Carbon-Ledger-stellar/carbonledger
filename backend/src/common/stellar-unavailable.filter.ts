import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { StellarUnavailableException } from './stellar-unavailable.exception';

@Catch(StellarUnavailableException)
export class StellarUnavailableExceptionFilter implements ExceptionFilter {
  catch(exception: StellarUnavailableException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (!response.headersSent) {
      response
        .status(HttpStatus.SERVICE_UNAVAILABLE)
        .set('Connection', 'keep-alive')
        .set('Retry-After', '30')
        .json(exception.getResponse());
    }
  }
}
