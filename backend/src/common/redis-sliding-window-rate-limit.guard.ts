import { CanActivate, ExecutionContext, Injectable, Logger, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { RedisService } from '../redis.service';
import { getRouteTier, getTierConfig, RateLimitTierName } from './rate-limit.config';
import { rateLimitMetricsRegistry } from './metrics.registry';

/**
 * Parses the INTERNAL_IP_WHITELIST env var (comma-separated CIDRs or IPs) once at
 * module load time, returning an array of plain IP strings.  CIDR support is kept
 * intentionally simple — only /32 and /128 exact-host CIDRs are supported here;
 * true subnet ranges should be handled upstream (e.g. nginx / Cloudflare firewall).
 */
function loadWhitelist(): Set<string> {
  const raw = process.env.INTERNAL_IP_WHITELIST ?? '';
  const entries = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    // strip /32 and /128 suffix so callers can write "10.0.0.1/32" or "10.0.0.1"
    .map((s) => s.replace(/\/(32|128)$/, ''));
  return new Set(entries);
}

const IP_WHITELIST = loadWhitelist();

@Injectable()
export class RedisSlidingWindowRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RedisSlidingWindowRateLimitGuard.name);

  constructor(private readonly redisService: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: { publicKey?: string; role?: string } }>();
    const res = context.switchToHttp().getResponse<Response>();
    const path = req.path ?? '/';

    // #1076: Skip rate limiting for whitelisted internal IPs.
    const clientIp = this.extractClientIp(req);
    if (IP_WHITELIST.size > 0 && clientIp && IP_WHITELIST.has(clientIp)) {
      return true;
    }

    const tier = this.resolveTier(req, path);
    const config = getTierConfig(tier);
    const identity = this.resolveIdentity(req, tier, clientIp);
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
        // #1076: Track blocked requests in metrics.
        rateLimitMetricsRegistry.recordBlocked(tier);

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

      // #1076: Track allowed requests in metrics.
      rateLimitMetricsRegistry.recordHit(tier);

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

  /**
   * Extract the real client IP respecting Cloudflare and proxy headers.
   *
   * Priority order (#1076 — DDoS mitigation):
   *   1. CF-Connecting-IP  (set by Cloudflare, most trustworthy when behind CF)
   *   2. X-Forwarded-For   (first IP in the chain — the original client)
   *   3. req.ip            (Express trust-proxy value)
   *   4. socket remoteAddress
   */
  extractClientIp(req: Request): string {
    const cfIp = req.headers['cf-connecting-ip'];
    if (cfIp && typeof cfIp === 'string' && cfIp.trim()) {
      return cfIp.trim();
    }

    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      const raw = Array.isArray(xff) ? xff[0] : xff;
      const first = raw.split(',')[0]?.trim();
      if (first) return first;
    }

    return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
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

  private resolveIdentity(req: Request, tier: RateLimitTierName, clientIp?: string): string {
    const user = req.user?.publicKey;
    if (user) {
      return `user:${user}`;
    }
    return clientIp ?? req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  }
}
