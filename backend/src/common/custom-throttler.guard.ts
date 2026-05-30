import { Injectable, ExecutionContext, HttpStatus } from "@nestjs/common";
import { ThrottlerGuard, ThrottlerException } from "@nestjs/throttler";

/**
 * Custom ThrottlerGuard that sends a proper 429 JSON response
 * with Connection: keep-alive so supertest doesn't get ECONNRESET.
 */
@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(
    context: ExecutionContext,
    _throttlerLimitDetail: any,
  ): Promise<void> {
    const res = context.switchToHttp().getResponse();
    // Send a proper 429 response with keep-alive to prevent ECONNRESET
    res
      .status(HttpStatus.TOO_MANY_REQUESTS)
      .set("Connection", "keep-alive")
      .json({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: "Too Many Requests",
        error: "ThrottlerException",
      });
    // Still throw so the guard returns false and the handler is not called
    throw new ThrottlerException();
  }
}
