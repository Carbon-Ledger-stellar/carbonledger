import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus, Inject } from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { Response } from "express";
import { ResponseAlreadySentException } from "../auth/login-rate-limit.guard";
import { LoggerService } from "../logger/logger.service";

/**
 * Catches ThrottlerException and sends a well-formed 429 JSON response
 * with Connection: keep-alive to prevent ECONNRESET in tests.
 */
@Catch(ThrottlerException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  catch(_exception: ThrottlerException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (!res.headersSent) {
      res
        .status(HttpStatus.TOO_MANY_REQUESTS)
        .set("Connection", "keep-alive")
        .set("Retry-After", "60")
        .json({
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: "Too Many Requests",
          error: "ThrottlerException",
        });
    }
  }
}

/**
 * Catches ResponseAlreadySentException (thrown by LoginRateLimitGuard after
 * sending the response directly) and does nothing — the response is already sent.
 */
@Catch(ResponseAlreadySentException)
export class ResponseAlreadySentFilter implements ExceptionFilter {
  constructor(@Inject(LoggerService) private readonly logger: LoggerService) {}

  catch(_exception: ResponseAlreadySentException, _host: ArgumentsHost) {
    this.logger.debug("Response already sent by guard, filter doing nothing");
    // Response was already sent by the guard — nothing to do
  }
}
