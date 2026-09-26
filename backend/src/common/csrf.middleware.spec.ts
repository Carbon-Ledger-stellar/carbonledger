import { ForbiddenException } from '@nestjs/common';
import { CsrfMiddleware } from './csrf.middleware';

// ── Minimal request/response stubs ────────────────────────────────────────────

function makeReq(opts: {
  method?: string;
  path?: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
}): any {
  return {
    method: opts.method ?? 'GET',
    path: opts.path ?? '/test',
    cookies: opts.cookies ?? {},
    headers: opts.headers ?? {},
  };
}

function makeRes(): any {
  const headers: Record<string, string | string[]> = {};
  return {
    getHeader: (name: string) => headers[name],
    setHeader: (name: string, value: string | string[]) => {
      headers[name] = value;
    },
    _headers: headers,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CsrfMiddleware', () => {
  let middleware: CsrfMiddleware;

  beforeEach(() => {
    middleware = new CsrfMiddleware();
  });

  // ── Safe methods ──────────────────────────────────────────────────────────

  describe('safe methods', () => {
    it.each(['GET', 'HEAD', 'OPTIONS'])(
      '%s requests are allowed without CSRF token',
      (method) => {
        const req = makeReq({ method });
        const res = makeRes();
        const next = jest.fn();

        expect(() => middleware.use(req, res, next)).not.toThrow();
        expect(next).toHaveBeenCalledTimes(1);
      },
    );

    it('sets csrf-token cookie even on GET requests', () => {
      const req = makeReq({ method: 'GET' });
      const res = makeRes();
      middleware.use(req, res, jest.fn());
      const cookie = res._headers['Set-Cookie'];
      expect(Array.isArray(cookie) ? cookie.some((c: string) => c.includes('csrf-token')) : String(cookie).includes('csrf-token')).toBe(true);
    });
  });

  // ── Authorization header exemption ────────────────────────────────────────

  describe('Authorization header exemption', () => {
    it('POST with Authorization: Bearer <token> is exempt', () => {
      const req = makeReq({
        method: 'POST',
        headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.test.test' },
      });
      const res = makeRes();
      const next = jest.fn();

      expect(() => middleware.use(req, res, next)).not.toThrow();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('DELETE with Authorization header is exempt', () => {
      const req = makeReq({
        method: 'DELETE',
        headers: { authorization: 'bearer some-token' },
      });
      const res = makeRes();
      const next = jest.fn();

      expect(() => middleware.use(req, res, next)).not.toThrow();
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  // ── Missing CSRF token ────────────────────────────────────────────────────

  describe('missing CSRF token', () => {
    it('POST without any CSRF token throws ForbiddenException', () => {
      const req = makeReq({ method: 'POST' });
      const res = makeRes();

      expect(() => middleware.use(req, res, jest.fn())).toThrow(ForbiddenException);
    });

    it('PUT without csrf header throws ForbiddenException', () => {
      const req = makeReq({
        method: 'PUT',
        cookies: { 'csrf-token': 'abc123' },
        // no x-csrf-token header
      });
      const res = makeRes();

      expect(() => middleware.use(req, res, jest.fn())).toThrow(ForbiddenException);
    });

    it('DELETE without csrf cookie throws ForbiddenException', () => {
      const req = makeReq({
        method: 'DELETE',
        headers: { 'x-csrf-token': 'abc123' },
        // no csrf-token cookie
      });
      const res = makeRes();

      expect(() => middleware.use(req, res, jest.fn())).toThrow(ForbiddenException);
    });
  });

  // ── Token mismatch ────────────────────────────────────────────────────────

  describe('CSRF token mismatch', () => {
    it('POST with non-matching cookie and header throws ForbiddenException', () => {
      const req = makeReq({
        method: 'POST',
        cookies: { 'csrf-token': 'correct-token' },
        headers: { 'x-csrf-token': 'wrong-token' },
      });
      const res = makeRes();

      expect(() => middleware.use(req, res, jest.fn())).toThrow(ForbiddenException);
    });

    it('error message says invalid when tokens do not match', () => {
      const req = makeReq({
        method: 'POST',
        cookies: { 'csrf-token': 'aaa' },
        headers: { 'x-csrf-token': 'bbb' },
      });
      const res = makeRes();

      try {
        middleware.use(req, res, jest.fn());
        fail('Expected ForbiddenException');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ForbiddenException);
        expect(e.message).toMatch(/invalid/i);
      }
    });
  });

  // ── Valid CSRF token ──────────────────────────────────────────────────────

  describe('valid CSRF token', () => {
    it('POST with matching cookie and header passes', () => {
      const token = 'a'.repeat(64);
      const req = makeReq({
        method: 'POST',
        cookies: { 'csrf-token': token },
        headers: { 'x-csrf-token': token },
      });
      const res = makeRes();
      const next = jest.fn();

      expect(() => middleware.use(req, res, next)).not.toThrow();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('PATCH with matching tokens passes', () => {
      const token = 'deadbeef'.repeat(8);
      const req = makeReq({
        method: 'PATCH',
        cookies: { 'csrf-token': token },
        headers: { 'x-csrf-token': token },
      });
      const res = makeRes();
      const next = jest.fn();

      expect(() => middleware.use(req, res, next)).not.toThrow();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('cookie is parsed from raw header string when req.cookies is empty', () => {
      const token = 'raw-header-token';
      const req = makeReq({
        method: 'POST',
        cookies: {}, // simulate missing cookie-parser
        headers: {
          cookie: `other=value; csrf-token=${token}; another=val`,
          'x-csrf-token': token,
        },
      });
      const res = makeRes();
      const next = jest.fn();

      expect(() => middleware.use(req, res, next)).not.toThrow();
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  // ── Cookie issuance ───────────────────────────────────────────────────────

  describe('cookie issuance', () => {
    it('issues a new csrf-token cookie when none exists', () => {
      const req = makeReq({ method: 'GET' });
      const res = makeRes();
      middleware.use(req, res, jest.fn());

      const setCookie = res._headers['Set-Cookie'];
      const cookies: string[] = Array.isArray(setCookie) ? setCookie : [setCookie as string];
      expect(cookies.some((c) => c.startsWith('csrf-token='))).toBe(true);
    });

    it('does not overwrite an existing csrf-token cookie', () => {
      const existingToken = 'existing-token-value';
      const req = makeReq({
        method: 'GET',
        cookies: { 'csrf-token': existingToken },
      });
      const res = makeRes();
      middleware.use(req, res, jest.fn());

      // No Set-Cookie header should be added since cookie already exists
      const setCookie = res._headers['Set-Cookie'];
      expect(setCookie).toBeUndefined();
    });
  });
});
