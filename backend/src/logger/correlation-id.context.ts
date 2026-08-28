import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuidv4 } from 'uuid';
import { getTraceId } from '../telemetry/tracing';

export interface CorrelationContext {
  correlationId: string;
  traceId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  duration?: number;
  actor?: string;
  ip?: string;
}

/**
 * AsyncLocalStorage for managing correlation context across async operations.
 * This ensures correlation IDs are maintained throughout the entire request lifecycle.
 */
export class CorrelationIdContext {
  private static readonly storage = new AsyncLocalStorage<CorrelationContext>();

  static generateCorrelationId(): string {
    return uuidv4();
  }

  static setContext(context: CorrelationContext): void {
    this.storage.enterWith(context);
  }

  static getContext(): CorrelationContext | undefined {
    return this.storage.getStore();
  }

  static getCorrelationId(): string {
    return this.storage.getStore()?.correlationId || getTraceId();
  }

  static getTraceId(): string {
    return this.storage.getStore()?.traceId || getTraceId();
  }

  static run<T>(context: CorrelationContext, fn: () => T): T {
    return this.storage.run(context, fn);
  }
}

