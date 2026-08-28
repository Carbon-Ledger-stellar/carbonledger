import { CanActivate, ExecutionContext, Injectable, Logger, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { RedisService } from '../redis.service';
import { getRouteTier, getTierConfig, RateLimitTierName } from './rate-limit.config';

@Injectable()
export class RedisSlidingWindowRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RedisSlidingWindowRateLimitGuard.name);

  constructor(private readonly redisService: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: { publicKey?: string; role?: string } }>();
    const res = context.switchToHttp().getResponse<Response>();
    const path = req.path ?? '/';

    // Admin override: administrators are exempt from sliding-window limits
    // entirely (issue #960) — operational/incident-response tooling must
    // never be blocked by the same quotas applied to regular traffic.
    if (req.user?.role === 'admin') {
      res.setHeader('X-RateLimit-Bypass', 'admin');
      return true;
    }

    const tier = this.resolveTier(req, path);
    const config = getTierConfig(tier);
    const identity = this.resolveIdentity(req, tier);
    const key = `rate-limit:${tier}:${identity}:${path}`;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    const client = this.redisService.getClient();
    if (!client) {
      return true;
    }

    try {
      const raw = await client.lrange(key, 0, -1);
      const timestamps = raw
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value) && value > windowStart);

      const count = timestamps.length;
      const burstAllowance = Math.max(0, config.burstAllowance);
      const limit = Math.max(1, config.limit + burstAllowance);
      const remaining = Math.max(0, limit - count);
      const resetAt = timestamps.length ? Math.max(...timestamps) + config.windowMs : now + config.windowMs;
      const resetEpoch = Math.ceil(resetAt / 1000);

      res.setHeader('X-RateLimit-Limit', String(limit));
      res.setHeader('X-RateLimit-Remaining', String(remaining));
      res.setHeader('X-RateLimit-Reset', String(resetEpoch));

      if (count >= limit) {
        res.status(HttpStatus.TOO_MANY_REQUESTS);
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((resetAt - now) / 1000))));
        res.json({
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too Many Requests',
          error: 'RateLimitExceeded',
          retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
          tier,
        });
        return false;
      }

      timestamps.push(now);
      await client.ltrim(key, 1, -1);
      await client.rpush(key, String(now));
      await client.expire(key, Math.ceil(config.windowMs / 1000));
      return true;
    } catch (error) {
      this.logger.warn(`Rate limit check failed for ${key}: ${(error as Error).message}`);
      return true;
    }
  }

  private resolveTier(req: Request, path: string): RateLimitTierName {
    if (!req.user?.publicKey) {
      return 'unauthenticated';
    }

    const routeTier = getRouteTier(path);
    if (routeTier === 'financial') {
      return 'financial';
    }
    return 'authenticated';
  }

  private resolveIdentity(req: Request, tier: RateLimitTierName): string {
    const user = req.user?.publicKey;
    if (user) {
      return tier === 'financial' ? `user:${user}` : `user:${user}`;
    }
    return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  }
}
