import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * #1076: DDoS-protection middleware.
 *
 * Responsibilities:
 *   1. Add standard security headers to every response.
 *   2. Pass through CF-Ray so downstream clients can correlate requests with
 *      Cloudflare's edge logs.
 *   3. Optionally log a warning when suspicious header combinations are detected
 *      (e.g. X-Forwarded-For without CF-Connecting-IP in a CF-fronted deployment).
 *
 * This middleware does NOT block requests — it is defence-in-depth on top of the
 * sliding-window rate limiter and login brute-force guard.  Actual traffic blocking
 * happens at the Cloudflare firewall / WAF layer.
 *
 * Registration: app.use(new DdosProtectionMiddleware().use) in main.ts, OR via
 * MiddlewareConsumer in AppModule.
 */
@Injectable()
export class DdosProtectionMiddleware implements NestMiddleware {
  private readonly logger = new Logger(DdosProtectionMiddleware.name);

  use(req: Request, res: Response, next: NextFunction): void {
    // ── Security headers ──────────────────────────────────────────────────────

    // Prevent MIME-type sniffing.
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Disallow embedding in iframes (clickjacking protection).
    res.setHeader('X-Frame-Options', 'DENY');

    // Enable basic XSS filter in older browsers (belt-and-suspenders).
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Only allow HTTPS for future requests (1 year).
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    // No referrer information leaked to third-party origins.
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Restrict browser features that are irrelevant to this API.
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    // ── Cloudflare header passthrough ─────────────────────────────────────────

    // CF-Ray uniquely identifies the Cloudflare edge request.  Reflecting it in
    // the response lets API consumers correlate their request with CF support logs.
    const cfRay = req.headers['cf-ray'];
    if (cfRay) {
      res.setHeader('CF-Ray', Array.isArray(cfRay) ? cfRay[0] : cfRay);
    }

    // CF-Connecting-IP is set by Cloudflare to the real visitor IP.
    // Log a debug note so operators can confirm CF is in the chain.
    const cfConnectingIp = req.headers['cf-connecting-ip'];
    if (cfConnectingIp) {
      // Cloudflare is in the request path — real IP is available.
      // Nothing to block here; the rate-limit guard uses this value.
    } else if (req.headers['x-forwarded-for'] && process.env.CLOUDFLARE_ENFORCED === 'true') {
      // X-Forwarded-For present but CF-Connecting-IP missing.
      // When CLOUDFLARE_ENFORCED=true this is unexpected and may indicate
      // a request bypassing the CF edge — log for operator review.
      this.logger.warn(
        `Request from ${req.ip} has X-Forwarded-For but no CF-Connecting-IP — ` +
        `possible CF bypass (path: ${req.path})`,
      );
    }

    next();
  }
}
