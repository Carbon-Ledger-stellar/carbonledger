import { Injectable, CanActivate, ExecutionContext, HttpStatus } from "@nestjs/common";

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
}
