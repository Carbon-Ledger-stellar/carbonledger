import { Injectable, Logger } from '@nestjs/common';
import { LoggerService } from './logger.service';
import { CorrelationIdContext } from './correlation-id.context';

export interface FinancialTraceContext {
  correlationId?: string;
  user_id?: string;
  operation?: string;
  contract_function?: string;
  tx_hash?: string;
  duration_ms?: number;
  module?: string;
  [key: string]: unknown;
}

@Injectable()
export class FinancialTracingService {
  private readonly logger = new Logger(FinancialTracingService.name);

  constructor(private readonly baseLogger: LoggerService) {}

  logFinancialOperation(message: string, context: FinancialTraceContext = {}) {
    const correlationId = context.correlationId || CorrelationIdContext.getCorrelationId();
    const sanitized = this.sanitizeContext(context);
    this.baseLogger.log(message, {
      ...sanitized,
      correlationId,
      operation: sanitized.operation ?? 'financial_operation',
      duration_ms: sanitized.duration_ms ?? 0,
      module: sanitized.module ?? 'financial'
    });
  }

  logFinancialError(message: string, error: unknown, context: FinancialTraceContext = {}) {
    const correlationId = context.correlationId || CorrelationIdContext.getCorrelationId();
    const sanitized = this.sanitizeContext(context);
    this.baseLogger.error(message, error instanceof Error ? error.stack : String(error), {
      ...sanitized,
      correlationId,
      operation: sanitized.operation ?? 'financial_operation',
      duration_ms: sanitized.duration_ms ?? 0,
      module: sanitized.module ?? 'financial'
    });
  }

  private sanitizeContext(context: FinancialTraceContext) {
    const sanitized: FinancialTraceContext = { ...context };
    const secretKeys = ['password', 'secret', 'token', 'key', 'private_key', 'authorization'];
    for (const key of Object.keys(sanitized)) {
      if (secretKeys.some((secretKey) => key.toLowerCase().includes(secretKey))) {
        sanitized[key] = '[REDACTED]';
      }
    }
    return sanitized;
  }
}
