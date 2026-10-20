import { HttpException, HttpStatus } from '@nestjs/common';

export interface PauseExceptionOptions {
  message?: string;
  pause_reason?: string | null;
}

/**
 * PauseException — thrown when an operation cannot be executed because
 * contract operations are currently paused (#1225).
 *
 * Extends NestJS HttpException, returns HTTP 409 Conflict status code,
 * and attaches the optional pause_reason to the error payload.
 */
export class PauseException extends HttpException {
  public readonly pause_reason: string | null;

  constructor(
    messageOrOptions?: string | PauseExceptionOptions,
    pause_reason?: string | null,
  ) {
    let msg: string;
    let reason: string | null = null;

    if (typeof messageOrOptions === 'object' && messageOrOptions !== null) {
      reason = messageOrOptions.pause_reason ?? null;
      msg =
        messageOrOptions.message ??
        (reason ? `Contract operations are paused: ${reason}` : 'Contract operations are currently paused');
    } else {
      reason = pause_reason ?? null;
      msg =
        messageOrOptions ??
        (reason ? `Contract operations are paused: ${reason}` : 'Contract operations are currently paused');
    }

    super(
      {
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: msg,
        pause_reason: reason,
      },
      HttpStatus.CONFLICT,
    );

    this.pause_reason = reason;
  }
}
