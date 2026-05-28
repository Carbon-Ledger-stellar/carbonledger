import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { randomUUID } from "crypto";
import { LoggerService } from "../logger/logger.service";

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    const trace_id = (req.headers["x-trace-id"] as string) ?? randomUUID();
    req.trace_id = trace_id;
    res.setHeader("x-trace-id", trace_id);

    // Extract domain context from JWT payload (attached by passport)
    const user = req.user as { id?: string } | undefined;
    const user_id = user?.id;
    const contract_id = (req.headers["x-contract-id"] as string) ?? undefined;

    const start = Date.now();

    this.logger.log(`${req.method} ${req.url}`, {
      trace_id,
      user_id,
      contract_id,
      ip: req.ip,
    });

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - start}ms`, {
            trace_id,
            user_id,
            contract_id,
            status: res.statusCode,
            duration_ms: Date.now() - start,
          });
        },
        error: (err: Error) => {
          this.logger.error(`${req.method} ${req.url} ERROR`, err.stack, {
            trace_id,
            user_id,
            contract_id,
            error: err.message,
          });
        },
      }),
    );
  }
}
