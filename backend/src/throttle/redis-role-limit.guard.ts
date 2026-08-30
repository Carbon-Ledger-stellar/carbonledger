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
import { RedisQuotaStore } from './redis-quota.store';
import { AdaptiveLoadMonitor } from './adaptive-load.monitor';

/**
 * Redis-backed role-based rate limiting guard (issue #1017).
 *
 * Roles and per-minute limits:
 *   public  → 10  req/min
 *   user    → 100 req/min
 *   premium → 1000 req/min
 *
 * Redis key format: rate_limit:{userId}:{endpoint}
 *
 * On exhaustion returns HTTP 429 with:
 *   Retry-After        — seconds until the window resets
 *   X-RateLimit-Limit  — effective burst ceiling
 *   X-RateLimit-Remaining — requests remaining this window
 *   X-RateLimit-Reset  — UTC epoch seconds for window reset
 *
 * Adaptive throttling: when AdaptiveLoadMonitor reports high CPU load the
 * effective limit is multiplied by ADAPTIVE_MULTIPLIER (0.50).
 *
 * Burst allowance: requests may exceed the base limit by BURST_MULTIPLIER
 * (1.10 = 10%) before the guard blocks.
 */
@Injectable()
export class RedisRoleLimitGuard implements CanActivate {
  private readonly logger = new Logger(RedisRoleLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly store: RedisQuotaStore,
    private readonly loadMonitor: AdaptiveLoadMonitor,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();

    // ── @SkipThrottle() opt-out ──────────────────────────────────────────────
    if (this.reflector.get<boolean>('skip_throttle', handler)) {
      return true;
    }

    const http = context.switchToHttp();
    const req  = http.getRequest<Request & { user?: { publicKey: string; role: string } }>();
    const res  = http.getResponse<Response>();

    // ── Determine role & identity ────────────────────────────────────────────
    const role     = req.user?.role ?? 'public';
    const identity = req.user?.publicKey ?? this.clientIp(req);
    const endpoint = req.path ?? '/';

    // ── Resolve bucket name ──────────────────────────────────────────────────
    const bucket = this.resolveBucket(handler, req);

    // ── Look up quota definition for this role + bucket ──────────────────────
    const roleQuotas = ROLE_QUOTAS[role] ?? ROLE_QUOTAS['public'];
    const quotaDef   = roleQuotas[bucket] ?? roleQuotas['default'];

    if (!quotaDef) {
      // No quota defined → fail open
      return true;
    }

    const now = Date.now();

    // ── Adaptive throttling ──────────────────────────────────────────────────
    const adaptiveMultiplier = this.loadMonitor.isHighLoad ? ADAPTIVE_MULTIPLIER : 1;
    const baseLimit    = Math.floor(quotaDef.limit * adaptiveMultiplier);
    const burstCeiling = Math.floor(baseLimit * BURST_MULTIPLIER);

    // ── Redis key format per issue #1017: rate_limit:{userId}:{endpoint} ─────
    const key   = `${identity}:${endpoint}`;
    const state = await this.store.incrementAsync(key, quotaDef.windowMs, now);

    const remaining  = Math.max(0, burstCeiling - state.count);
    const resetEpoch = Math.ceil(state.resetAt / 1000);

    // Set rate limit headers on every response
    res.setHeader('X-RateLimit-Limit',     burstCeiling);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset',     resetEpoch);

    if (state.count > burstCeiling) {
      const retryAfter =
        Math.ceil(this.store.ttl(key, now) / 1000) ||
        Math.ceil(quotaDef.windowMs / 1000);

      res.setHeader('Retry-After', retryAfter);

      this.logger.warn(
        `Rate limit exceeded — identity=${identity} role=${role} ` +
        `endpoint=${endpoint} count=${state.count} limit=${burstCeiling}`,
      );

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error:      'Too Many Requests',
          message:    `Rate limit exceeded. Limit: ${baseLimit} requests per minute.`,
          retryAfter,
          resetAt:    new Date(state.resetAt).toISOString(),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Resolve bucket name using the same priority order as RoleLimitGuard:
   * 1. @QuotaBucket('name') decorator
   * 2. PATH_BUCKET_OVERRIDES prefix match
   * 3. HTTP method → bucket mapping
   * 4. Fallback: 'default'
   */
  private resolveBucket(handler: Function, req: Request): string {
    const decorated = this.reflector.get<string>('quota_bucket', handler);
    if (decorated) return decorated;

    const path = req.path ?? '';
    for (const override of PATH_BUCKET_OVERRIDES) {
      if (path.startsWith(override.prefix)) {
        return override.bucket;
      }
    }

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
}
