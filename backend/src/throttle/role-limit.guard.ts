import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import {
  ROLE_QUOTAS,
  PATH_BUCKET_OVERRIDES,
  METHOD_BUCKET_MAP,
  BURST_MULTIPLIER,
  ADAPTIVE_MULTIPLIER,
} from './quota.config';
import { QuotaStore } from './quota.store';
import { AdaptiveLoadMonitor } from './adaptive-load.monitor';

/**
 * Decorator that overrides the bucket name for a specific route.
 *
 * Usage:
 *   @QuotaBucket('mint')
 *   @Post('mint')
 *   mintCredits() { ... }
 */
export const QuotaBucket = (bucket: string) =>
  (target: any, key?: string, descriptor?: any) => {
    Reflect.defineMetadata('quota_bucket', bucket, descriptor?.value ?? target);
    return descriptor ?? target;
  };

/**
 * Decorator that skips rate limiting for a route entirely.
 *
 * Usage:
 *   @SkipThrottle()
 *   @Get('health')
 *   health() { ... }
 */
export const SkipThrottle = () =>
  (target: any, key?: string, descriptor?: any) => {
    Reflect.defineMetadata('skip_throttle', true, descriptor?.value ?? target);
    return descriptor ?? target;
  };

/**
 * RoleLimitGuard enforces per-role, per-bucket quotas.
 *
 * ## Resolution order for bucket name
 * 1. `@QuotaBucket('name')` decorator on handler
 * 2. PATH_BUCKET_OVERRIDES prefix match
 * 3. METHOD_BUCKET_MAP (GET → 'read', POST → 'write', …)
 * 4. Fallback: 'default'
 *
 * ## Identity for quota key
 * - Authenticated requests:  JWT subject (`user.publicKey`)
 * - Unauthenticated:         IP address (treated as 'public' role)
 *
 * ## Adaptive throttling
 * When AdaptiveLoadMonitor.isHighLoad is true the effective limit is halved.
 *
 * ## Burst allowance
 * Requests may exceed the base limit by 10% for the duration of the window.
 * Once the burst ceiling is hit the request is rejected.
 *
 * ## Response headers
 * Every rate-limited response includes:
 *   X-RateLimit-Limit     — effective limit (post-adaptive)
 *   X-RateLimit-Remaining — requests left in window
 *   X-RateLimit-Reset     — UTC epoch seconds when window resets
 */
@Injectable()
export class RoleLimitGuard implements CanActivate {
  private readonly logger = new Logger(RoleLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly store: QuotaStore,
    private readonly loadMonitor: AdaptiveLoadMonitor,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();

    // ── Skip throttle opt-out ─────────────────────────────────────────────────
    if (this.reflector.get<boolean>('skip_throttle', handler)) {
      return true;
    }

    const http = context.switchToHttp();
    const req  = http.getRequest<Request & { user?: { publicKey: string; role: string } }>();
    const res  = http.getResponse<Response>();

    // ── Determine role & identity ─────────────────────────────────────────────
    const role     = req.user?.role ?? 'public';
    const identity = req.user?.publicKey ?? this.clientIp(req);

    // ── Resolve bucket name ───────────────────────────────────────────────────
    const bucket = this.resolveBucket(handler, req);

    // ── Look up quota for this role + bucket ──────────────────────────────────
    const roleQuotas = ROLE_QUOTAS[role] ?? ROLE_QUOTAS['public'];
    const quotaDef   = roleQuotas[bucket] ?? roleQuotas['default'];

    if (!quotaDef) {
      // No quota defined → allow (fail open for unknown roles/buckets)
      return true;
    }

    const now = Date.now();

    // ── Adaptive throttling ───────────────────────────────────────────────────
    const adaptiveMultiplier = this.loadMonitor.isHighLoad ? ADAPTIVE_MULTIPLIER : 1;
    const baseLimit    = Math.floor(quotaDef.limit * adaptiveMultiplier);
    const burstCeiling = Math.floor(baseLimit * BURST_MULTIPLIER);

    // ── Quota check ───────────────────────────────────────────────────────────
    const key   = `${identity}:${bucket}`;
    const state = this.store.increment(key, quotaDef.windowMs, now);

    const remaining  = Math.max(0, burstCeiling - state.count);
    const resetEpoch = Math.ceil(state.resetAt / 1000);

    // Set quota headers on every response
    res.setHeader('X-RateLimit-Limit',     burstCeiling);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset',     resetEpoch);

    if (state.count > burstCeiling) {
      this.logger.warn(
        `Rate limit exceeded — identity=${identity} role=${role} ` +
        `bucket=${bucket} count=${state.count} limit=${burstCeiling}`,
      );
      const retryAfter = Math.ceil(this.store.ttl(key, now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      throw new HttpException(
        {
          statusCode:  HttpStatus.TOO_MANY_REQUESTS,
          error:       'Too Many Requests',
          message:     `Rate limit exceeded. Quota: ${baseLimit} ${quotaDef.name} requests per ${this.windowLabel(quotaDef.windowMs)}. Burst ceiling: ${burstCeiling}.`,
          retryAfter,
          resetAt:     new Date(state.resetAt).toISOString(),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private resolveBucket(handler: Function, req: Request): string {
    // 1. Decorator override
    const decorated = this.reflector.get<string>('quota_bucket', handler);
    if (decorated) return decorated;

    // 2. Path prefix override
    const path = req.path ?? '';
    for (const override of PATH_BUCKET_OVERRIDES) {
      if (path.startsWith(override.prefix)) {
        return override.bucket;
      }
    }

    // 3. HTTP method → bucket
    const method = (req.method ?? 'GET').toUpperCase();
    return METHOD_BUCKET_MAP[method] ?? 'default';
  }

  private clientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress ?? 'unknown';
  }

  private windowLabel(windowMs: number): string {
    if (windowMs >= 24 * 60 * 60 * 1000) return 'day';
    if (windowMs >= 60 * 60 * 1000)      return 'hour';
    if (windowMs >= 60 * 1000)           return 'minute';
    return 'second';
  }
}
