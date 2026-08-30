/**
 * Tiered Redis-backed rate limiting middleware for the CarbonLedger indexer API.
 *
 * Tiers:
 *  - localhost/internal: unlimited
 *  - API key (X-API-Key header, validated against Redis set `api_keys`): 600 req/min, burst 60/sec
 *  - anonymous: 60 req/min, burst 10/sec
 *
 * Auto-blocking: if an IP hits the rate limit 10 times within 5 minutes it is
 * added to the `blocked_ips` Redis set for 1 hour.  Every blocked request
 * returns 429 with a Retry-After header.
 *
 * Prometheus counters are exported via the shared `metricsRegistry` instance.
 *
 * Rate limiters are constructed lazily on first use so that tests can inject
 * a Redis mock before any Redis connection is attempted.
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { rateLimit, Options as RateLimitOptions } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { Counter, Registry } from 'prom-client';
import { getRedisClient } from '../redis-client';

// ── Prometheus metrics ───────────────────────────────────────────────────────

export const metricsRegistry = new Registry();

const rateLimitedCounter = new Counter({
  name: 'indexer_rate_limited_requests_total',
  help: 'Total number of rate-limited requests by tier',
  labelNames: ['tier'] as const,
  registers: [metricsRegistry],
});

const blockedIpCounter = new Counter({
  name: 'indexer_blocked_ip_events_total',
  help: 'Total number of automatic IP block events',
  registers: [metricsRegistry],
});

// ── Constants ────────────────────────────────────────────────────────────────

export const BLOCKED_IPS_KEY = 'blocked_ips';
export const API_KEYS_SET_KEY = 'api_keys';
export const VIOLATION_PREFIX = 'rl_violations:';
export const VIOLATION_WINDOW_SECONDS = 5 * 60; // 5 minutes
export const VIOLATION_THRESHOLD = 10;
export const BLOCK_DURATION_SECONDS = 60 * 60; // 1 hour

const INTERNAL_HOSTS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

// ── Helper utilities ─────────────────────────────────────────────────────────

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? '127.0.0.1';
}

export function isInternalRequest(ip: string): boolean {
  return INTERNAL_HOSTS.has(ip);
}

export async function isApiKeyValid(key: string): Promise<boolean> {
  const redis = getRedisClient();
  const result = await redis.sismember(API_KEYS_SET_KEY, key);
  return result === 1;
}

export async function isIpBlocked(ip: string): Promise<boolean> {
  const redis = getRedisClient();
  const result = await redis.sismember(BLOCKED_IPS_KEY, ip);
  return result === 1;
}

export async function recordViolation(ip: string): Promise<number> {
  const redis = getRedisClient();
  const key = `${VIOLATION_PREFIX}${ip}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, VIOLATION_WINDOW_SECONDS);
  }
  return count;
}

export async function blockIp(ip: string): Promise<void> {
  const redis = getRedisClient();
  await redis.sadd(BLOCKED_IPS_KEY, ip);
  const expKey = `blocked_ip_ttl:${ip}`;
  await redis.set(expKey, '1', 'EX', BLOCK_DURATION_SECONDS);
  blockedIpCounter.inc();
}

async function maybeUnblockIp(ip: string): Promise<boolean> {
  const redis = getRedisClient();
  const expKey = `blocked_ip_ttl:${ip}`;
  const exists = await redis.exists(expKey);
  if (exists === 0) {
    await redis.srem(BLOCKED_IPS_KEY, ip);
    return false;
  }
  return true;
}

// ── Block-check middleware ───────────────────────────────────────────────────

export async function blocklistMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const ip = getClientIp(req);
  if (isInternalRequest(ip)) {
    next();
    return;
  }

  try {
    const blocked = await isIpBlocked(ip);
    if (blocked) {
      const stillBlocked = await maybeUnblockIp(ip);
      if (stillBlocked) {
        res.set('Retry-After', String(BLOCK_DURATION_SECONDS));
        res.status(429).json({
          error: 'Too Many Requests',
          message: 'Your IP has been temporarily blocked due to excessive requests.',
          retryAfter: BLOCK_DURATION_SECONDS,
        });
        return;
      }
    }
  } catch {
    // Redis unavailable — fail open
  }

  next();
}

// ── Rate limiter factory (lazy) ──────────────────────────────────────────────

/**
 * Build a RedisStore on first use. This lazy pattern ensures the Redis client
 * (and any test mock) is fully initialised before the store tries to connect.
 */
function makeRedisStore(prefix: string): RedisStore {
  return new RedisStore({
    // @ts-expect-error — rate-limit-redis v4 accepts ioredis client via sendCommand
    sendCommand: (...args: string[]) => getRedisClient().call(...args),
    prefix: `rl:${prefix}:`,
  });
}

/**
 * Cached limiter instances — built lazily on first middleware invocation.
 */
const limiters: Record<string, RequestHandler> = {};

function getLimiter(
  tier: 'anonymous' | 'api_key',
  scope: 'minute' | 'burst',
): RequestHandler {
  const key = `${tier}:${scope}`;
  if (!limiters[key]) {
    const config: Record<string, { windowMs: number; max: number }> = {
      'anonymous:minute': { windowMs: 60_000, max: 60 },
      'anonymous:burst':  { windowMs: 1_000,  max: 10 },
      'api_key:minute':   { windowMs: 60_000, max: 600 },
      'api_key:burst':    { windowMs: 1_000,  max: 60 },
    };
    const { windowMs, max } = config[key];
    const options: Partial<RateLimitOptions> = {
      windowMs,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      store: makeRedisStore(`${tier}_${scope}`),
      keyGenerator: (req) => getClientIp(req),
      skip: (req) => isInternalRequest(getClientIp(req)),
      handler: async (req, res) => {
        const ip = getClientIp(req);
        rateLimitedCounter.inc({ tier });
        try {
          const violations = await recordViolation(ip);
          if (violations >= VIOLATION_THRESHOLD) {
            await blockIp(ip);
          }
        } catch {
          // Redis error — still return 429
        }
        res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
        res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded for ${tier} tier.`,
          retryAfter: Math.ceil(windowMs / 1000),
        });
      },
    };
    limiters[key] = rateLimit(options);
  }
  return limiters[key];
}

// ── Main tiered middleware ───────────────────────────────────────────────────

export async function tieredRateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const ip = getClientIp(req);

  // Tier 1: internal/localhost — unlimited
  if (isInternalRequest(ip)) {
    next();
    return;
  }

  // Tier 2: API key
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    try {
      const valid = await isApiKeyValid(apiKey);
      if (valid) {
        getLimiter('api_key', 'burst')(req, res, () => {
          getLimiter('api_key', 'minute')(req, res, next);
        });
        return;
      }
    } catch {
      // Redis unavailable — fall through to anonymous tier
    }
  }

  // Tier 3: anonymous
  getLimiter('anonymous', 'burst')(req, res, () => {
    getLimiter('anonymous', 'minute')(req, res, next);
  });
}

// ── Admin API key management ─────────────────────────────────────────────────

export async function listApiKeys(_req: Request, res: Response): Promise<void> {
  const redis = getRedisClient();
  const keys = await redis.smembers(API_KEYS_SET_KEY);
  res.json({ keys });
}

export async function addApiKey(req: Request, res: Response): Promise<void> {
  const { key } = req.body as { key?: string };
  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    res.status(400).json({ error: 'Missing or invalid key in request body' });
    return;
  }
  const redis = getRedisClient();
  await redis.sadd(API_KEYS_SET_KEY, key.trim());
  res.status(201).json({ message: 'API key added', key: key.trim() });
}

export async function deleteApiKey(req: Request, res: Response): Promise<void> {
  const { key } = req.params;
  if (!key) {
    res.status(400).json({ error: 'Missing key parameter' });
    return;
  }
  const redis = getRedisClient();
  const removed = await redis.srem(API_KEYS_SET_KEY, key);
  if (removed === 0) {
    res.status(404).json({ error: 'API key not found' });
    return;
  }
  res.json({ message: 'API key deleted', key });
}

export async function unblockIp(req: Request, res: Response): Promise<void> {
  const { ip } = req.body as { ip?: string };
  if (!ip || typeof ip !== 'string' || ip.trim().length === 0) {
    res.status(400).json({ error: 'Missing or invalid ip in request body' });
    return;
  }
  const cleanIp = ip.trim();
  const redis = getRedisClient();
  await redis.srem(BLOCKED_IPS_KEY, cleanIp);
  await redis.del(`blocked_ip_ttl:${cleanIp}`);
  await redis.del(`${VIOLATION_PREFIX}${cleanIp}`);
  res.json({ message: 'IP unblocked', ip: cleanIp });
}

// ── Admin auth guard ─────────────────────────────────────────────────────────

export function adminAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    res.status(503).json({ error: 'Admin endpoints not configured' });
    return;
  }
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${adminToken}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
