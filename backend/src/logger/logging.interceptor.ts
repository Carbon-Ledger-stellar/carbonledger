import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { LoggerService } from "../logger/logger.service";
import { CorrelationIdContext } from "./correlation-id.context";

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    const correlationId = (req as any).correlationId;
    const method = req.method;
    const path = req.path;

    // Extract domain context from JWT payload (attached by passport)
    const user = req.user as { id?: string } | undefined;
    const user_id = user?.id;
    const contract_id = (req.headers["x-contract-id"] as string) ?? undefined;

    const start = Date.now();

    // Log incoming request
    this.logger.log(`${method} ${path}`, {
      correlationId,
      user_id,
      contract_id,
      ip: req.ip,
    });

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - start;
          const statusCode = res.statusCode;

          // Update correlation context with response details
          CorrelationIdContext.setContext({
            correlationId,
            method,
            path,
            statusCode,
            duration,
          });

          // Log successful response with structured fields
          this.logger.log(`${method} ${path} completed`, {
            correlationId,
            user_id,
            contract_id,
            statusCode,
            duration,
          });
        },
        error: (err: Error) => {
          const duration = Date.now() - start;
          const statusCode = res.statusCode || 500;

          // Update correlation context with error details
          CorrelationIdContext.setContext({
            correlationId,
            method,
            path,
            statusCode,
            duration,
          });

          // Log error with structured fields
          this.logger.error(`${method} ${path} failed`, err.stack, {
            correlationId,
            user_id,
            contract_id,
            statusCode,
            duration,
            error: err.message,
          });
        },
      }),
    );
  }
}
