import { Injectable, CanActivate, ExecutionContext, HttpStatus } from "@nestjs/common";

// Sentinel exception to signal that the response was already sent by the guard
export class ResponseAlreadySentException extends Error {
  constructor() { super("Response already sent"); }
}

/**
 * Simple in-memory rate limiter for the login endpoint.
 * Uses a synchronous counter to avoid race conditions with parallel requests.
 * Limit: 5 requests per minute per IP.
 */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly counters = new Map<string, { count: number; resetAt: number }>();
  private readonly LIMIT = 5;
  private readonly WINDOW_MS = 60_000;

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    const now = Date.now();

    let entry = this.counters.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + this.WINDOW_MS };
      this.counters.set(ip, entry);
    }

    entry.count++;

    if (entry.count > this.LIMIT) {
      // Send 429 directly to avoid ECONNRESET from exception handling
      res
        .status(HttpStatus.TOO_MANY_REQUESTS)
        .set("Connection", "keep-alive")
        .json({
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: "Too Many Requests",
          error: "RateLimitExceeded",
        });
      // Throw sentinel to prevent NestJS from sending another response
      throw new ResponseAlreadySentException();
    }

    return true;
  }
}
