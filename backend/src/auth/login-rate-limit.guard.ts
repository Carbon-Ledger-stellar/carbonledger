import { Injectable, CanActivate, ExecutionContext, HttpStatus, Logger } from "@nestjs/common";
import { Request, Response } from "express";
import * as IORedis from "ioredis";

// Sentinel exception to signal that the response was already sent by the guard
export class ResponseAlreadySentException extends Error {
  constructor() { super("Response already sent"); }
}

interface RateLimitEntry {
  /** Number of requests in the current window. */
  count: number;
  /** Epoch ms when the current window resets. */
  resetAt: number;
  /** How many times this IP has been rate-limited (drives exponential backoff). */
  violations: number;
}

/**
 * Per-IP rate limiter for the login endpoint with exponential backoff.
 *
 * Base behaviour:
 *   - 5 requests per minute per IP (LIMIT / BASE_WINDOW_MS)
 *   - 6th request in the same window → HTTP 429 with Retry-After header
 *
 * Exponential backoff:
 *   - Each rate-limit violation doubles the window length:
 *       1st violation → 1 min, 2nd → 2 min, 3rd → 4 min, …, max 10 min
 *   - The violation counter resets when an IP goes a full clean window without
 *     being blocked.
 *
 * NOTE: This is an in-memory guard suitable for single-instance deployments.
 * For multi-instance setups, replace the Map with a shared Redis counter.
 */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  /** Maximum requests allowed in the base window. */
  private readonly LIMIT = 5;

  /** Base sliding-window length: 60 seconds. */
  private readonly BASE_WINDOW_MS = 60_000;

  /** Maximum window multiplier (caps at 10× = 10 minutes). */
  private readonly MAX_MULTIPLIER = 10;

  private readonly entries = new Map<string, RateLimitEntry>();

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const ip: string = req.ip || req.connection?.remoteAddress || "unknown";
    const now = Date.now();

    // ── Retrieve or create entry for this IP ────────────────────────────────
    let entry = this.entries.get(ip);

    if (!entry || now > entry.resetAt) {
      // New window — carry forward the violation count if the IP was blocked
      // in its previous window; otherwise reset violations too.
      const violations = entry ? entry.violations : 0;
      const multiplier = Math.min(2 ** violations, this.MAX_MULTIPLIER);
      const windowMs = this.BASE_WINDOW_MS * multiplier;
      entry = { count: 0, resetAt: now + windowMs, violations };
      this.entries.set(ip, entry);
    }
  }

    entry.count++;

    if (entry.count > this.LIMIT) {
      // Record the violation so the next window will be longer
      entry.violations++;

      const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);

      res
        .status(HttpStatus.TOO_MANY_REQUESTS)
        .set("Connection", "keep-alive")
        .set("Retry-After", String(retryAfterSeconds))
        .json({
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: "Too Many Requests",
          error: "RateLimitExceeded",
          retryAfter: retryAfterSeconds,
        });

      // Throw sentinel so NestJS does not attempt to send a second response
      throw new ResponseAlreadySentException();
    }

    return true;
  }

  /**
   * Reset the attempt counter for an IP after a successful login.
   * Called by AuthService after credentials are validated.
   */
  async resetAttempts(ip: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(`login:attempts:${ip}`);
    } catch (err: unknown) {
      this.logger.warn(`LoginRateLimitGuard resetAttempts failed for ${ip}: ${(err as Error).message}`);
    }
  }

  /**
   * Extract the real client IP respecting Cloudflare and reverse-proxy headers.
   *
   * Priority (#1076 — DDoS mitigation):
   *   1. CF-Connecting-IP  — set by Cloudflare edge, most trustworthy
   *   2. X-Forwarded-For   — first IP in the chain
   *   3. req.ip            — Express trust-proxy result
   *   4. socket remoteAddress
   */
  extractClientIp(req: Request): string {
    const cfIp = req.headers['cf-connecting-ip'];
    if (cfIp && typeof cfIp === 'string' && cfIp.trim()) {
      return cfIp.trim();
    }

    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      const raw   = Array.isArray(xff) ? xff[0] : xff;
      const first = raw.split(',')[0]?.trim();
      if (first) return first;
    }

    return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  }

  private sendTooManyRequests(res: Response, retryAfterSeconds: number): void {
    res
      .status(HttpStatus.TOO_MANY_REQUESTS)
      .set('Retry-After', String(retryAfterSeconds))
      .set('Connection', 'keep-alive')
      .json({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message:    'Too many login attempts. Please try again later.',
        error:      'RateLimitExceeded',
        retryAfter: retryAfterSeconds,
      });
    // Throw sentinel so NestJS does not attempt to send a second response.
    throw new ResponseAlreadySentException();
  }
}
