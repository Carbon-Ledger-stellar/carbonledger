import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';

/**
 * Metadata key used to attach a throttle tier to a route handler.
 * Usage: @ThrottleTier('premium')
 */
export const THROTTLE_TIER_KEY = 'throttle_tier';

export type ApiKeyTier = 'default' | 'basic' | 'premium';

export interface TierLimit {
  /** Max requests allowed within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

const DEFAULT_TIER_LIMITS: Record<ApiKeyTier, TierLimit> = {
  default: { limit: 60, windowMs: 60_000 },
  basic: { limit: 300, windowMs: 60_000 },
  premium: { limit: 1_000, windowMs: 60_000 },
};

interface BucketEntry {
  count: number;
  resetAt: number;
}

/**
 * Per-API-key throttler for public-api endpoints.
 *
 * Replaces the shared global throttle so a single heavy consumer cannot
 * exhaust the quota for everyone else. Limits are resolved per API key tier
 * (default/basic/premium) and are configurable via environment variables:
 *   PUBLIC_API_THROTTLE_<TIER>_LIMIT
 *   PUBLIC_API_THROTTLE_<TIER>_WINDOW_MS
 *
 * When a key exceeds its limit the guard throws a 429 that includes a
 * Retry-After header (in seconds) telling the client when to retry.
 */
@Injectable()
export class ApiKeyThrottlerGuard implements CanActivate {
  private readonly buckets = new Map<string, BucketEntry>();
  private readonly tierLimits: Record<ApiKeyTier, TierLimit>;

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {
    this.tierLimits = {
      default: this.resolveLimit('default'),
      basic: this.resolveLimit('basic'),
      premium: this.resolveLimit('premium'),
    };
  }

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const apiKey = this.extractApiKey(request);
    if (!apiKey) {
      // No key present: let the API-key auth guard handle rejection.
      return true;
    }

    const tier = this.resolveTier(context, request);
    const { limit, windowMs } = this.tierLimits[tier];
    const now = Date.now();

    const bucketKey = `${tier}:${apiKey}`;
    let entry = this.buckets.get(bucketKey);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      this.buckets.set(bucketKey, entry);
    }

    entry.count += 1;

    const remaining = Math.max(0, limit - entry.count);
    response.setHeader('X-RateLimit-Limit', String(limit));
    response.setHeader('X-RateLimit-Remaining', String(remaining));
    response.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      response.setHeader('Retry-After', String(retryAfterSeconds));
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Rate limit exceeded for this API key',
          retryAfter: retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private resolveTier(context: ExecutionContext, request: Request): ApiKeyTier {
    const handlerTier = this.reflector.getAllAndOverride<ApiKeyTier | undefined>(
      THROTTLE_TIER_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (handlerTier && handlerTier in this.tierLimits) {
      return handlerTier;
    }

    const requestTier = (request as Request & { apiKeyTier?: string }).apiKeyTier;
    if (requestTier && requestTier in this.tierLimits) {
      return requestTier as ApiKeyTier;
    }

    return 'default';
  }

  private extractApiKey(request: Request): string | undefined {
    const headerKey = request.header('x-api-key');
    if (headerKey) {
      return headerKey;
    }

    const auth = request.header('authorization');
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      return auth.slice(7).trim() || undefined;
    }

    return undefined;
  }

  private resolveLimit(tier: ApiKeyTier): TierLimit {
    const fallback = DEFAULT_TIER_LIMITS[tier];
    const envPrefix = `PUBLIC_API_THROTTLE_${tier.toUpperCase()}`;

    const limit = this.parsePositiveInt(
      this.configService.get<string>(`${envPrefix}_LIMIT`),
      fallback.limit,
    );
    const windowMs = this.parsePositiveInt(
      this.configService.get<string>(`${envPrefix}_WINDOW_MS`),
      fallback.windowMs,
    );

    return { limit, windowMs };
  }

  private parsePositiveInt(value: string | undefined, fallback: number): number {
    if (value === undefined || value === null || value === '') {
      return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  }
}
