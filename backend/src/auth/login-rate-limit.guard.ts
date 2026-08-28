import { Injectable, CanActivate, ExecutionContext, HttpStatus, Logger } from "@nestjs/common";
import { Request, Response } from "express";
import * as IORedis from "ioredis";

// Sentinel exception to signal that the response was already sent by the guard
export class ResponseAlreadySentException extends Error {
  constructor() { super("Response already sent"); }
}

/**
 * #1076: Redis-backed brute-force protection for the login endpoint.
 *
 * Rules:
 *   - Max 5 failed attempts per IP within the 15-minute lockout window.
 *   - On the 6th attempt the IP is locked out for 900 seconds (15 min).
 *   - Survives process restarts because state lives in Redis, not memory.
 *   - Extracts real client IP from CF-Connecting-IP → X-Forwarded-For → req.ip
 *     so Cloudflare-fronted deployments rate-limit on the actual user IP.
 *
 * Redis keys:
 *   login:attempts:{ip}  — incremented counter, TTL = LOCKOUT_SECONDS
 *   login:locked:{ip}    — set when attempts >= LIMIT, TTL = LOCKOUT_SECONDS
 */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly logger  = new Logger(LoginRateLimitGuard.name);
  private readonly redis: IORedis.Redis | null;

  /** Maximum login attempts before the IP is locked out. */
  private readonly LIMIT = 5;
  /** Lockout duration in seconds (15 minutes). */
  private readonly LOCKOUT_SECONDS = 900;

  constructor() {
    try {
      this.redis = new IORedis.default({
        host:     process.env.REDIS_HOST     ?? 'localhost',
        port:     parseInt(process.env.REDIS_PORT ?? '6379', 10),
        password: process.env.REDIS_PASSWORD ?? undefined,
        // Don't block startup if Redis is temporarily unavailable.
        lazyConnect:    true,
        enableOfflineQueue: false,
        connectTimeout: 2_000,
      });
      this.redis.on('error', (err: Error) => {
        this.logger.warn(`LoginRateLimitGuard Redis error: ${err.message}`);
      });
    } catch {
      this.logger.warn('LoginRateLimitGuard: failed to create Redis client — falling back to allow-all');
      this.redis = null;
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const ip  = this.extractClientIp(req);

    // If Redis is unavailable, fail open (do not block the endpoint).
    if (!this.redis) {
      return true;
    }

    const lockedKey   = `login:locked:${ip}`;
    const attemptsKey = `login:attempts:${ip}`;

    try {
      // Check whether this IP is already in a lockout period.
      const locked = await this.redis.get(lockedKey);
      if (locked) {
        const ttl = await this.redis.ttl(lockedKey);
        this.sendTooManyRequests(res, ttl > 0 ? ttl : this.LOCKOUT_SECONDS);
        return false;
      }

      // Increment attempt counter; set expiry on first attempt so the window
      // automatically resets even if the IP never hits the limit.
      const attempts = await this.redis.incr(attemptsKey);
      if (attempts === 1) {
        // First attempt in this window — set the expiry.
        await this.redis.expire(attemptsKey, this.LOCKOUT_SECONDS);
      }

      if (attempts > this.LIMIT) {
        // Lock the IP for the full lockout window.
        await this.redis.set(lockedKey, '1', 'EX', this.LOCKOUT_SECONDS);
        // Remove the attempts key — lock key is the authoritative signal now.
        await this.redis.del(attemptsKey);

        this.sendTooManyRequests(res, this.LOCKOUT_SECONDS);
        return false;
      }
    } catch (err: unknown) {
      // Redis error — log and fail open so a Redis hiccup never blocks all logins.
      this.logger.warn(`LoginRateLimitGuard check failed for ${ip}: ${(err as Error).message}`);
    }

    return true;
  }

  /**
   * Reset the attempt counter for an IP after a successful login.
   * Called by AuthService after credentials are validated.
   */
  async resetAttempts(ip: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(`login:attempts:${ip}`);
    } catch (err: unknown) {
      this.logger.warn(`LoginRateLimitGuard resetAttempts failed for ${ip}: ${(err as Error).message}`);
    }
  }

  /**
   * Extract the real client IP respecting Cloudflare and reverse-proxy headers.
   *
   * Priority (#1076 — DDoS mitigation):
   *   1. CF-Connecting-IP  — set by Cloudflare edge, most trustworthy
   *   2. X-Forwarded-For   — first IP in the chain
   *   3. req.ip            — Express trust-proxy result
   *   4. socket remoteAddress
   */
  extractClientIp(req: Request): string {
    const cfIp = req.headers['cf-connecting-ip'];
    if (cfIp && typeof cfIp === 'string' && cfIp.trim()) {
      return cfIp.trim();
    }

    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      const raw   = Array.isArray(xff) ? xff[0] : xff;
      const first = raw.split(',')[0]?.trim();
      if (first) return first;
    }

    return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  }

  private sendTooManyRequests(res: Response, retryAfterSeconds: number): void {
    res
      .status(HttpStatus.TOO_MANY_REQUESTS)
      .set('Retry-After', String(retryAfterSeconds))
      .set('Connection', 'keep-alive')
      .json({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message:    'Too many login attempts. Please try again later.',
        error:      'RateLimitExceeded',
        retryAfter: retryAfterSeconds,
      });
    // Throw sentinel so NestJS does not attempt to send a second response.
    throw new ResponseAlreadySentException();
  }
}
