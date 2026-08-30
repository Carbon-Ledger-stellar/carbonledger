import { AsyncLocalStorage } from 'async_hooks';
import { v4 as uuidv4 } from 'uuid';

export interface CorrelationContext {
  correlationId: string;
  method?: string;
  path?: string;
  statusCode?: number;
  duration?: number;
  /** Authenticated user ID (from JWT sub) */
  actorId?: string;
  /** Authenticated user role (from JWT role claim) */
  actorRole?: string;
  /** Sampling decision: true = emit log, false = suppress (info/debug level) */
  sampled?: boolean;
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
    return this.storage.getStore()?.correlationId ?? '';
  }

  /** Patch specific fields without replacing the full context */
  static patchContext(patch: Partial<CorrelationContext>): void {
    const existing = this.storage.getStore();
    if (existing) {
      this.storage.enterWith({ ...existing, ...patch });
    }
  }

  static run<T>(context: CorrelationContext, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  /**
   * Sampling decision.
   * Returns true if this request should be logged at info/debug level.
   * Error-level logs are always emitted regardless of sampling.
   *
   * Strategy:
   *   - 100% of requests with errors are emitted
   *   - 10% of normal (info/debug) requests are emitted (reservoir sampling)
   *   - The decision is stored per-request in AsyncLocalStorage so it is
   *     consistent throughout the request lifecycle
   */
  static shouldSample(): boolean {
    const ctx = this.storage.getStore();
    if (!ctx) return true; // outside request context: always log

    // Once a sampling decision has been made, honour it
    if (ctx.sampled !== undefined) return ctx.sampled;

    const sampled = Math.random() < 0.1; // 10% sample rate for normal ops
    this.patchContext({ sampled });
    return sampled;
  }

  /** Force-enable sampling for this request (called when an error is detected) */
  static forceSample(): void {
    this.patchContext({ sampled: true });
  }
}
