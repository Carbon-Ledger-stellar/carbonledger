import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuidv4 } from 'uuid';

export interface CorrelationContext {
  /** UUID v4 that uniquely identifies one HTTP request (or BullMQ job). */
  correlationId: string;
  method?: string;
  path?: string;
  /** HTTP status code, populated after response. */
  statusCode?: number;
  /** Request duration in ms, populated after response. */
  duration?: number;
  /** Stellar public key of the authenticated caller (from JWT). */
  actor?: string;
  /** Role of the authenticated caller: project_developer | corporation | verifier | admin. */
  role?: string;
  /** Endpoint label, e.g. "POST /api/v1/credits/mint". */
  endpoint?: string;
}

/**
 * AsyncLocalStorage for managing correlation context across async operations.
 * Using enterWith() ensures the context propagates through the entire
 * async call chain without requiring every function to pass it explicitly.
 */
export class CorrelationIdContext {
  private static readonly storage = new AsyncLocalStorage<CorrelationContext>();

  static generateCorrelationId(): string {
    return uuidv4();
  }

  static setContext(context: CorrelationContext): void {
    this.storage.enterWith(context);
  }

  /**
   * Merge additional fields into the current context without replacing it.
   * Useful for enriching a context that was already set (e.g. adding actor/role
   * after JWT validation completes).
   */
  static enrichContext(fields: Partial<CorrelationContext>): void {
    const current = this.storage.getStore();
    if (current) {
      Object.assign(current, fields);
    }
  }

  static getContext(): CorrelationContext | undefined {
    return this.storage.getStore();
  }

  static getCorrelationId(): string {
    return this.storage.getStore()?.correlationId ?? '';
  }

  /**
   * Run fn inside an isolated context store.
   * Used for BullMQ job processors so each job gets its own correlation ID.
   */
  static run<T>(context: CorrelationContext, fn: () => T): T {
    return this.storage.run(context, fn);
  }
}
