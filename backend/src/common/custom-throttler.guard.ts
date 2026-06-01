import { Injectable, ExecutionContext } from "@nestjs/common";
import { ThrottlerGuard, ThrottlerException, ThrottlerLimitDetail } from "@nestjs/throttler";
import { Request, Response } from "express";

/**
 * Smart rate-limiting guard that:
 * - Uses IP as tracker for unauthenticated requests
 * - Uses user public key as tracker for JWT-authenticated requests
 * - Adds X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset headers to every response
 * - Returns 429 with Retry-After header when the limit is exceeded
 *
 * The base ThrottlerGuard already sets headers with throttler-name suffixes
 * (e.g. X-RateLimit-Limit-public). This guard additionally sets the plain
 * X-RateLimit-Limit / X-RateLimit-Remaining headers for the active throttler.
 */
@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  /** Use IP for unauthenticated requests, user public key for authenticated ones. */
  protected async getTracker(req: Request): Promise<string> {
    const user = (req as any).user;
    if (user?.publicKey) return `user:${user.publicKey}`;
    return req.ip ?? (req.socket as any)?.remoteAddress ?? "unknown";
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const res = context.switchToHttp().getResponse<Response>();
    const retryAfter = Math.ceil(throttlerLimitDetail.timeToExpire / 1000);

    if (!res.headersSent) {
      res
        .status(429)
        .set("Connection", "keep-alive")
        .set("Retry-After", String(retryAfter))
        .set("X-RateLimit-Limit", String(throttlerLimitDetail.limit))
        .set("X-RateLimit-Remaining", "0")
        .json({
          statusCode: 429,
          message: "Too Many Requests",
          error: "ThrottlerException",
          retryAfter,
        });
    }

    throw new ThrottlerException();
  }
}
