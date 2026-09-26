import { ArgumentsHost, BadRequestException, ConflictException, ForbiddenException, HttpStatus, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function makeHost(req: Partial<any> = {}) {
  const json = jest.fn();
  const set = jest.fn(() => ({ json }));
  const status = jest.fn(() => ({ set, json }));
  const response = { status, headersSent: false } as any;
  const request = { method: 'GET', originalUrl: '/api/v1/thing', ...req } as any;

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, set, json };
}

describe('AllExceptionsFilter', () => {
  it('formats a NotFoundException into the standard error envelope', () => {
    const filter = new AllExceptionsFilter();
    const { host, status, set, json } = makeHost();

    filter.catch(new NotFoundException('Project proj-1 not found'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(set).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        code: 'NOT_FOUND',
        message: 'Project proj-1 not found',
      }),
    );
  });

  it('preserves extra fields on the exception response (e.g. per-item batch errors)', () => {
    const filter = new AllExceptionsFilter();
    const { host, json } = makeHost();

    filter.catch(
      new BadRequestException({ message: 'bad batch', results: [{ index: 0, status: 'error' }] }),
      host,
    );

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        results: [{ index: 0, status: 'error' }],
      }),
    );
  });

  it('maps ForbiddenException and ConflictException to their correct status/code', () => {
    const filter = new AllExceptionsFilter();

    const forbidden = makeHost();
    filter.catch(new ForbiddenException('nope'), forbidden.host);
    expect(forbidden.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(forbidden.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));

    const conflict = makeHost();
    filter.catch(new ConflictException('dup'), conflict.host);
    expect(conflict.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(conflict.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONFLICT' }));
  });

  it('collapses an unknown thrown error to a generic 500 without leaking internals', () => {
    const filter = new AllExceptionsFilter();
    const { host, status, json } = makeHost();

    filter.catch(new Error('secret db connection string leaked here'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = json.mock.calls[0][0];
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).not.toContain('secret db connection string');
  });

  it('does nothing if the response was already sent', () => {
    const filter = new AllExceptionsFilter();
    const { host, status } = makeHost();
    (host.switchToHttp().getResponse() as any).headersSent = true;

    filter.catch(new Error('too late'), host);

    expect(status).not.toHaveBeenCalled();
  });
});
