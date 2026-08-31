import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RedisRoleLimitGuard } from './redis-role-limit.guard';
import { RedisQuotaStore } from './redis-quota.store';
import { AdaptiveLoadMonitor } from './adaptive-load.monitor';
import { ROLE_QUOTAS, BURST_MULTIPLIER } from './quota.config';

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a mock ExecutionContext with configurable request/response properties.
 * responseHeaders is shared so tests can inspect the headers set by the guard.
 */
function makeContext(
  opts: {
    role?: string;
    publicKey?: string;
    method?: string;
    path?: string;
    ip?: string;
    handlerMeta?: Record<string, unknown>;
  } = {},
): { ctx: ExecutionContext; responseHeaders: Record<string, unknown> } {
  const responseHeaders: Record<string, unknown> = {};

  const req = {
    user:   opts.role ? { role: opts.role, publicKey: opts.publicKey ?? 'wallet-test' } : undefined,
    method: opts.method ?? 'GET',
    path:   opts.path ?? '/api/v1/stats',
    socket: { remoteAddress: opts.ip ?? '127.0.0.1' },
    headers: {},
  };

  const res = {
    setHeader: (k: string, v: unknown) => { responseHeaders[k] = v; },
    _headers: responseHeaders,
  };

  const handler = jest.fn();
  for (const [key, value] of Object.entries(opts.handlerMeta ?? {})) {
    Reflect.defineMetadata(key, value, handler);
  }

  const ctx = {
    getHandler:   () => handler,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;

  return { ctx, responseHeaders };
}

/**
 * Build a RedisRoleLimitGuard backed by a no-Redis RedisQuotaStore
 * (falls back to in-memory) so tests don't require a running Redis instance.
 */
function makeGuard(loadMonitor?: Partial<AdaptiveLoadMonitor>) {
  const reflector = new Reflector();
  // Pass no redisService → always uses in-memory fallback
  const store     = new RedisQuotaStore();
  const monitor   = new AdaptiveLoadMonitor();
  if (loadMonitor) Object.assign(monitor, loadMonitor);
  return {
    guard:   new RedisRoleLimitGuard(reflector, store, monitor),
    store,
    monitor,
  };
}

/**
 * Fire the guard N times and return counts of allowed vs blocked.
 * Consumes a single execution context per call.
 */
async function fireN(
  guard: RedisRoleLimitGuard,
  n: number,
  ctxOpts: Parameters<typeof makeContext>[0],
): Promise<{ allowed: number; blocked: number }> {
  let allowed = 0;
  let blocked = 0;
  for (let i = 0; i < n; i++) {
    const { ctx } = makeContext(ctxOpts);
    try {
      await guard.canActivate(ctx);
      allowed++;
    } catch {
      blocked++;
    }
  }
  return { allowed, blocked };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('RedisRoleLimitGuard (issue #1017)', () => {

  // ── Issue #1017 role limits ──────────────────────────────────────────────

  describe('public role — 10 req/min', () => {
    it('allows up to the burst ceiling (10 * 1.10 = 11) and blocks beyond', async () => {
      const { guard } = makeGuard();
      const baseLimit    = ROLE_QUOTAS.public.default.limit;          // 10
      const burstCeiling = Math.floor(baseLimit * BURST_MULTIPLIER); // 11

      const { allowed, blocked } = await fireN(guard, burstCeiling + 3, {
        role: 'public',
        method: 'GET',
        path: '/api/v1/stats',
      });

      expect(allowed).toBe(burstCeiling);
      expect(blocked).toBe(3);
    });

    it('throws HTTP 429 after exceeding public limit', async () => {
      const { guard } = makeGuard();
      const baseLimit    = ROLE_QUOTAS.public.default.limit;
      const burstCeiling = Math.floor(baseLimit * BURST_MULTIPLIER);

      // Exhaust the quota
      for (let i = 0; i < burstCeiling; i++) {
        const { ctx } = makeContext({ role: 'public', method: 'GET', path: '/api/v1/stats' });
        try { await guard.canActivate(ctx); } catch { /* expected at end */ }
      }

      // The next request should be rejected
      const { ctx } = makeContext({ role: 'public', method: 'GET', path: '/api/v1/stats' });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
    });

    it('base limit for public role is 10', () => {
      expect(ROLE_QUOTAS.public.default.limit).toBe(10);
      expect(ROLE_QUOTAS.public.default.windowMs).toBe(60 * 1000);
    });
  });

  describe('user role — 100 req/min', () => {
    it('allows up to burst ceiling (100 * 1.10 = 110) and blocks beyond', async () => {
      const { guard } = makeGuard();
      const baseLimit    = ROLE_QUOTAS.user.default.limit;            // 100
      const burstCeiling = Math.floor(baseLimit * BURST_MULTIPLIER); // 110

      const { allowed, blocked } = await fireN(guard, burstCeiling + 4, {
        role: 'user',
        publicKey: 'user-wallet',
        method: 'GET',
        path: '/api/v1/stats',
      });

      expect(allowed).toBe(burstCeiling);
      expect(blocked).toBe(4);
    });

    it('base limit for user role is 100', () => {
      expect(ROLE_QUOTAS.user.default.limit).toBe(100);
      expect(ROLE_QUOTAS.user.default.windowMs).toBe(60 * 1000);
    });

    it('user write bucket is also 100/min', () => {
      expect(ROLE_QUOTAS.user.write.limit).toBe(100);
      expect(ROLE_QUOTAS.user.write.windowMs).toBe(60 * 1000);
    });
  });

  describe('premium role — 1000 req/min', () => {
    it('allows up to burst ceiling (1000 * 1.10 = 1100) and blocks beyond', async () => {
      const { guard } = makeGuard();
      const baseLimit    = ROLE_QUOTAS.premium.default.limit;         // 1000
      const burstCeiling = Math.floor(baseLimit * BURST_MULTIPLIER); // 1100

      const { allowed, blocked } = await fireN(guard, burstCeiling + 2, {
        role: 'premium',
        publicKey: 'premium-wallet',
        method: 'GET',
        path: '/api/v1/stats',
      });

      expect(allowed).toBe(burstCeiling);
      expect(blocked).toBe(2);
    });

    it('base limit for premium role is 1000', () => {
      expect(ROLE_QUOTAS.premium.default.limit).toBe(1000);
      expect(ROLE_QUOTAS.premium.default.windowMs).toBe(60 * 1000);
    });

    it('premium write bucket is also 1000/min', () => {
      expect(ROLE_QUOTAS.premium.write.limit).toBe(1000);
      expect(ROLE_QUOTAS.premium.write.windowMs).toBe(60 * 1000);
    });
  });

  // ── 429 response shape and headers ──────────────────────────────────────

  describe('429 response', () => {
    it('sets Retry-After header when limit is exceeded', async () => {
      const { guard } = makeGuard();
      const baseLimit    = ROLE_QUOTAS.public.default.limit;
      const burstCeiling = Math.floor(baseLimit * BURST_MULTIPLIER);

      // Exhaust quota
      for (let i = 0; i < burstCeiling; i++) {
        const { ctx } = makeContext({ role: 'public', method: 'GET', path: '/api/v1/stats' });
        try { await guard.canActivate(ctx); } catch { /* expected */ }
      }

      const { ctx, responseHeaders } = makeContext({
        role: 'public',
        method: 'GET',
        path: '/api/v1/stats',
      });

      try {
        await guard.canActivate(ctx);
        fail('Expected HttpException to be thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        expect((e as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect(responseHeaders['Retry-After']).toBeGreaterThan(0);
      }
    });

    it('sets X-RateLimit-* headers on the 429 response', async () => {
      const { guard } = makeGuard();
      const baseLimit    = ROLE_QUOTAS.public.default.limit;
      const burstCeiling = Math.floor(baseLimit * BURST_MULTIPLIER);

      for (let i = 0; i < burstCeiling; i++) {
        const { ctx } = makeContext({ role: 'public', method: 'GET', path: '/api/v1/stats' });
        try { await guard.canActivate(ctx); } catch { /* expected */ }
      }

      const { ctx, responseHeaders } = makeContext({
        role: 'public',
        method: 'GET',
        path: '/api/v1/stats',
      });

      try {
        await guard.canActivate(ctx);
      } catch {
        // Headers are set before the exception is thrown
      }

      expect(responseHeaders['X-RateLimit-Limit']).toBeDefined();
      expect(responseHeaders['X-RateLimit-Remaining']).toBeDefined();
      expect(responseHeaders['X-RateLimit-Reset']).toBeDefined();
    });

    it('429 body contains statusCode, message, retryAfter, and resetAt', async () => {
      const { guard } = makeGuard();
      const baseLimit    = ROLE_QUOTAS.public.default.limit;
      const burstCeiling = Math.floor(baseLimit * BURST_MULTIPLIER);

      for (let i = 0; i < burstCeiling; i++) {
        const { ctx } = makeContext({ role: 'public', method: 'GET', path: '/api/v1/stats' });
        try { await guard.canActivate(ctx); } catch { /* expected */ }
      }

      const { ctx } = makeContext({ role: 'public', method: 'GET', path: '/api/v1/stats' });
      try {
        await guard.canActivate(ctx);
        fail('Expected exception');
      } catch (e) {
        const body = (e as HttpException).getResponse() as any;
        expect(body.statusCode).toBe(429);
        expect(body.error).toBe('Too Many Requests');
        expect(typeof body.message).toBe('string');
        expect(body.retryAfter).toBeGreaterThan(0);
        expect(body.resetAt).toBeDefined();
        expect(new Date(body.resetAt).getTime()).toBeGreaterThan(Date.now());
      }
    });
  });

  // ── Basic allow / deny ───────────────────────────────────────────────────

  it('allows a request well within quota', async () => {
    const { guard } = makeGuard();
    const { ctx } = makeContext({ role: 'public', method: 'GET', path: '/api/v1/stats' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('sets X-RateLimit-* headers on every allowed response', async () => {
    const { guard } = makeGuard();
    const { ctx, responseHeaders } = makeContext({
      role: 'public',
      method: 'GET',
      path: '/api/v1/stats',
    });

    await guard.canActivate(ctx);

    expect(responseHeaders['X-RateLimit-Limit']).toBeDefined();
    expect(responseHeaders['X-RateLimit-Remaining']).toBeDefined();
    expect(responseHeaders['X-RateLimit-Reset']).toBeDefined();
  });

  // ── @SkipThrottle() ──────────────────────────────────────────────────────

  it('skips throttle when skip_throttle metadata is set', async () => {
    const { guard } = makeGuard();
    // Fire 500 times — should never throw
    for (let i = 0; i < 500; i++) {
      const { ctx } = makeContext({
        role: 'public',
        handlerMeta: { skip_throttle: true },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    }
  });

  // ── Identity isolation ───────────────────────────────────────────────────

  it('does not share quotas between different user identities', async () => {
    const { guard } = makeGuard();
    const baseLimit    = ROLE_QUOTAS.public.default.limit;
    const burstCeiling = Math.floor(baseLimit * BURST_MULTIPLIER);

    // Exhaust quota for wallet-A
    for (let i = 0; i < burstCeiling + 1; i++) {
      const { ctx } = makeContext({ role: 'public', publicKey: 'wallet-A', method: 'GET', path: '/api/v1/stats' });
      try { await guard.canActivate(ctx); } catch { /* expected */ }
    }

    // wallet-B should still have a fresh quota
    const { ctx: ctxB } = makeContext({ role: 'public', publicKey: 'wallet-B', method: 'GET', path: '/api/v1/stats' });
    await expect(guard.canActivate(ctxB)).resolves.toBe(true);
  });

  it('does not share quotas between different endpoints for same user', async () => {
    const { guard } = makeGuard();
    const baseLimit    = ROLE_QUOTAS.public.default.limit;
    const burstCeiling = Math.floor(baseLimit * BURST_MULTIPLIER);

    // Exhaust quota on /api/v1/stats for wallet-X
    for (let i = 0; i < burstCeiling + 1; i++) {
      const { ctx } = makeContext({ role: 'public', publicKey: 'wallet-X', method: 'GET', path: '/api/v1/stats' });
      try { await guard.canActivate(ctx); } catch { /* expected */ }
    }

    // Same wallet on a different endpoint should have a fresh quota
    const { ctx: ctxOther } = makeContext({
      role: 'public',
      publicKey: 'wallet-X',
      method: 'GET',
      path: '/api/v1/projects',
    });
    await expect(guard.canActivate(ctxOther)).resolves.toBe(true);
  });

  // ── Adaptive throttling ──────────────────────────────────────────────────

  it('halves effective limit under high load', async () => {
    const { guard, monitor } = makeGuard();
    monitor._forceHighLoad(true);

    const baseLimit       = ROLE_QUOTAS.user.default.limit;           // 100
    const adaptiveBase    = Math.floor(baseLimit * 0.50);             // 50
    const adaptiveCeiling = Math.floor(adaptiveBase * BURST_MULTIPLIER); // 55

    const { allowed, blocked } = await fireN(guard, adaptiveCeiling + 3, {
      role: 'user',
      publicKey: 'user-wallet',
      method: 'GET',
      path: '/api/v1/stats',
    });

    expect(allowed).toBe(adaptiveCeiling);
    expect(blocked).toBe(3);
  });

  // ── RedisQuotaStore in-memory fallback ────────────────────────────────────

  describe('RedisQuotaStore (in-memory fallback)', () => {
    it('increments count correctly', async () => {
      const store = new RedisQuotaStore(); // no Redis
      const now   = Date.now();
      const s1    = await store.incrementAsync('k:read', 60_000, now);
      expect(s1.count).toBe(1);
      const s2 = await store.incrementAsync('k:read', 60_000, now);
      expect(s2.count).toBe(2);
    });

    it('resets window when expired', async () => {
      const store = new RedisQuotaStore();
      const past  = Date.now() - 120_000; // 2 minutes ago
      await store.incrementAsync('k:read', 60_000, past); // window expired
      const now  = Date.now();
      const s    = await store.incrementAsync('k:read', 60_000, now);
      expect(s.count).toBe(1); // fresh window
    });

    it('evictExpired removes stale keys from fallback', () => {
      const store = new RedisQuotaStore();
      const past  = Date.now() - 120_000;
      store.increment('stale', 60_000, past); // write to fallback
      store.evictExpired(Date.now());
      const ttl = store.ttl('stale', Date.now());
      expect(ttl).toBe(0);
    });

    it('ttl returns positive ms while window is active', () => {
      const store = new RedisQuotaStore();
      const now   = Date.now();
      store.increment('active', 60_000, now);
      expect(store.ttl('active', now)).toBeGreaterThan(0);
      expect(store.ttl('active', now)).toBeLessThanOrEqual(60_000);
    });

    it('sync increment falls back to in-memory map', () => {
      const store = new RedisQuotaStore();
      const now   = Date.now();
      const s1    = store.increment('k', 60_000, now);
      expect(s1.count).toBe(1);
      const s2 = store.increment('k', 60_000, now);
      expect(s2.count).toBe(2);
    });
  });
});
