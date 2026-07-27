import { HttpException, HttpStatus } from '@nestjs/common';

export class StellarUnavailableException extends HttpException {
  constructor(message: string, details?: unknown) {
    super({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      message,
      details,
    }, HttpStatus.SERVICE_UNAVAILABLE);
  }
}
