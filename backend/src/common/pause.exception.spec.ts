import { HttpStatus, HttpException } from '@nestjs/common';
import { PauseException } from './pause.exception';

describe('PauseException (#1225)', () => {
  it('extends NestJS HttpException', () => {
    const exception = new PauseException();
    expect(exception).toBeInstanceOf(HttpException);
    expect(exception).toBeInstanceOf(PauseException);
  });

  it('returns HTTP 409 Conflict status code', () => {
    const exception = new PauseException();
    expect(exception.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(exception.getStatus()).toBe(409);
  });

  it('provides a clear default error message and null pause_reason when none supplied', () => {
    const exception = new PauseException();
    expect(exception.message).toBe('Contract operations are currently paused');
    expect(exception.pause_reason).toBeNull();

    const response = exception.getResponse() as Record<string, unknown>;
    expect(response).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
      message: 'Contract operations are currently paused',
      pause_reason: null,
    });
  });

  it('accepts a custom clear error message', () => {
    const customMsg = 'Minting is temporarily suspended due to emergency contract pause';
    const exception = new PauseException(customMsg);
    expect(exception.message).toBe(customMsg);
    expect(exception.pause_reason).toBeNull();

    const response = exception.getResponse() as Record<string, unknown>;
    expect(response.message).toBe(customMsg);
    expect(response.statusCode).toBe(409);
  });

  it('includes pause_reason field when provided as second argument', () => {
    const reason = 'Scheduled maintenance window';
    const exception = new PauseException('Custom msg', reason);
    expect(exception.pause_reason).toBe(reason);

    const response = exception.getResponse() as Record<string, unknown>;
    expect(response.pause_reason).toBe(reason);
    expect(response.message).toBe('Custom msg');
  });

  it('formats error message with pause_reason when options object is supplied', () => {
    const reason = 'Security vulnerability investigation';
    const exception = new PauseException({ pause_reason: reason });
    expect(exception.pause_reason).toBe(reason);
    expect(exception.message).toBe(`Contract operations are paused: ${reason}`);

    const response = exception.getResponse() as Record<string, unknown>;
    expect(response.pause_reason).toBe(reason);
    expect(response.message).toBe(`Contract operations are paused: ${reason}`);
  });

  it('preserves custom message when both message and pause_reason are supplied in options', () => {
    const message = 'Action rejected';
    const reason = 'Routine ledger upgrade';
    const exception = new PauseException({ message, pause_reason: reason });
    expect(exception.message).toBe(message);
    expect(exception.pause_reason).toBe(reason);
  });
});
