import { Injectable, NestMiddleware, ForbiddenException, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

/**
 * CSRF protection middleware using the Double-Submit Cookie pattern.
 *
 * Protection rules:
 *  - GET, HEAD, OPTIONS requests are skipped (safe methods, read-only).
 *  - Requests carrying a valid `Authorization` header are exempt — JWT-based
 *    API clients (Freighter wallet, mobile apps) are stateless and not
 *    vulnerable to CSRF because cookies are not their auth vector.
 *  - All other state-changing requests (POST, PUT, PATCH, DELETE) must supply:
 *      Cookie:  csrf-token=<token>
 *      Header:  x-csrf-token: <same-token>
 *    The middleware verifies both are present and equal (constant-time compare).
 *
 * Token issuance:
 *  - On every request a fresh `csrf-token` cookie is set if one is not already present.
 *  - The cookie is HttpOnly=false so the JS client can read it and mirror it in
 *    the `x-csrf-token` header (this is the double-submit intent).
 *  - The cookie is SameSite=Strict and Secure in production.
 *
 * Usage in app.module.ts:
 *   consumer.apply(CsrfMiddleware).forRoutes('*');
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private readonly logger = new Logger(CsrfMiddleware.name);

  /** HTTP methods that never change server state — exempt from CSRF checks. */
  private static readonly SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

  /** Cookie name for the CSRF token (must match what the frontend reads). */
  static readonly COOKIE_NAME = 'csrf-token';

  /** Header name the client must mirror the cookie value in. */
  static readonly HEADER_NAME = 'x-csrf-token';

  /** Token length in bytes (generates 32 bytes → 64 hex chars). */
  private static readonly TOKEN_BYTES = 32;

  use(req: Request, res: Response, next: NextFunction): void {
    // 1. Ensure every response carries a fresh (or refreshed) CSRF cookie
    //    so the frontend always has a token to use.
    const existingCookie = this.parseCsrfCookie(req);
    const csrfToken = existingCookie ?? this.generateToken();

    if (!existingCookie) {
      this.setCsrfCookie(res, csrfToken);
    }

    // 2. Safe methods (GET, HEAD, OPTIONS) — no validation required.
    if (CsrfMiddleware.SAFE_METHODS.has(req.method.toUpperCase())) {
      return next();
    }

    // 3. JWT-authenticated API clients are exempt.
    //    These clients explicitly set Authorization: Bearer <token>, proving
    //    they can read the token — browsers would never add this for cross-site
    //    requests without explicit JS code.
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      return next();
    }

    // 4. Validate double-submit: cookie must match the x-csrf-token header.
    const headerToken = (req.headers[CsrfMiddleware.HEADER_NAME] as string | undefined) ?? '';
    const cookieToken = this.parseCsrfCookie(req) ?? '';

    if (!cookieToken || !headerToken) {
      this.logger.warn(
        `CSRF token missing — method=${req.method} path=${req.path} ` +
        `hasCookie=${!!cookieToken} hasHeader=${!!headerToken}`,
      );
      throw new ForbiddenException('CSRF token missing');
    }

    if (!this.constantTimeEqual(cookieToken, headerToken)) {
      this.logger.warn(
        `CSRF token mismatch — method=${req.method} path=${req.path}`,
      );
      throw new ForbiddenException('CSRF token invalid');
    }

    next();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Generate a cryptographically random token (hex string). */
  private generateToken(): string {
    return crypto.randomBytes(CsrfMiddleware.TOKEN_BYTES).toString('hex');
  }

  /**
   * Parse the csrf-token cookie from the incoming request.
   * Handles `cookie` header manually to avoid a third-party cookie-parser dep.
   */
  private parseCsrfCookie(req: Request): string | undefined {
    // If the express cookie-parser middleware is already wired up, req.cookies
    // will be populated. Fall back to manual parsing if it is not.
    if (req.cookies && req.cookies[CsrfMiddleware.COOKIE_NAME]) {
      return req.cookies[CsrfMiddleware.COOKIE_NAME] as string;
    }

    const cookieHeader = req.headers['cookie'];
    if (!cookieHeader) return undefined;

    for (const part of cookieHeader.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name.trim() === CsrfMiddleware.COOKIE_NAME) {
        return decodeURIComponent(rest.join('='));
      }
    }
    return undefined;
  }

  /** Set the CSRF cookie on the outgoing response. */
  private setCsrfCookie(res: Response, token: string): void {
    const isProd = process.env.NODE_ENV === 'production';
    const cookieParts = [
      `${CsrfMiddleware.COOKIE_NAME}=${token}`,
      'Path=/',
      'SameSite=Strict',
      ...(isProd ? ['Secure'] : []),
      // NOTE: HttpOnly=false is intentional — the JS client MUST read this cookie.
    ];
    // Append rather than overwrite; other middleware may have already set cookies.
    const existing = res.getHeader('Set-Cookie');
    const cookies: string[] = Array.isArray(existing)
      ? existing
      : existing
      ? [existing as string]
      : [];
    cookies.push(cookieParts.join('; '));
    res.setHeader('Set-Cookie', cookies);
  }

  /**
   * Constant-time string comparison to prevent timing attacks.
   * Returns true only when both strings are identical.
   */
  private constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
    } catch {
      return false;
    }
  }
}
