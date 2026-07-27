import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleLimitGuard } from './role-limit.guard';
import { QuotaStore } from './quota.store';
import { AdaptiveLoadMonitor } from './adaptive-load.monitor';
import { ROLE_QUOTAS, BURST_MULTIPLIER } from './quota.config';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeContext(
  opts: {
    role?: string;
    publicKey?: string;
    method?: string;
    path?: string;
    ip?: string;
    handlerMeta?: Record<string, unknown>;
  } = {},
): ExecutionContext {
  const headers: Record<string, string> = {};
  const responseHeaders: Record<string, unknown> = {};

  const req = {
    user:   opts.role ? { role: opts.role, publicKey: opts.publicKey ?? 'wallet-abc' } : undefined,
    method: opts.method ?? 'GET',
    path:   opts.path ?? '/api/v1/stats',
    socket: { remoteAddress: opts.ip ?? '127.0.0.1' },
    headers,
  };

  const res = {
    setHeader: (k: string, v: unknown) => { responseHeaders[k] = v; },
    _headers: responseHeaders,
  };

  const handler = jest.fn();
  for (const [key, value] of Object.entries(opts.handlerMeta ?? {})) {
    Reflect.defineMetadata(key, value, handler);
  }

  return {
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
}

function makeGuard(loadMonitor?: Partial<AdaptiveLoadMonitor>) {
  const reflector = new Reflector();
  const store     = new QuotaStore();
  const monitor   = new AdaptiveLoadMonitor();
  if (loadMonitor) Object.assign(monitor, loadMonitor);
  return { guard: new RoleLimitGuard(reflector, store, monitor), store, monitor };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('RoleLimitGuard', () => {

  // ── Basic allow / deny ───────────────────────────────────────────────────

  it('allows a request well within quota', () => {
    const { guard } = makeGuard();
    const ctx = makeContext({ role: 'public', method: 'GET', path: '/api/v1/stats' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('sets X-RateLimit-* headers on every allowed response', () => {
    const resHeaders: Record<string, unknown> = {};
    const mockRes = {
      setHeader: (k: string, v: unknown) => { resHeaders[k] = v; },
    };
    const mockReq = {
      user:   { role: 'public', publicKey: 'wallet-abc' },
      method: 'GET',
      path:   '/api/v1/stats',
      socket: { remoteAddress: '127.0.0.1' },
      headers: {},
    };
    const handler = jest.fn();
    const ctx = {
      getHandler: () => handler,
      switchToHttp: () => ({ getRequest: () => mockReq, getResponse: () => mockRes }),
    } as unknown as ExecutionContext;

    const { guard } = makeGuard();
    guard.canActivate(ctx);

    expect(resHeaders['X-RateLimit-Limit']).toBeDefined();
    expect(resHeaders['X-RateLimit-Remaining']).toBeDefined();
    expect(resHeaders['X-RateLimit-Reset']).toBeDefined();
  });

  // ── @SkipThrottle() ──────────────────────────────────────────────────────

  it('skips throttle when skip_throttle metadata is set', () => {
    const { guard } = makeGuard();
    const ctx = makeContext({
      role: 'public',
      handlerMeta: { skip_throttle: true },
    });
    // Fire 200 times — should never throw
    for (let i = 0; i < 200; i++) {
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });

  // ── Role boundary enforcement ────────────────────────────────────────────

  it('enforces project mint quota (100/day)', () => {
    const { guard } = makeGuard();
    const mintLimit = ROLE_QUOTAS.project.mint.limit;
    const burstCeiling = Math.floor(mintLimit * BURST_MULTIPLIER);

    // Exhaust quota + burst
    let allowed = 0;
    let blocked = 0;
    for (let i = 0; i < burstCeiling + 5; i++) {
      const ctx = makeContext({ role: 'project', method: 'POST', path: '/api/v1/credits/mint' });
      try {
        guard.canActivate(ctx);
        allowed++;
      } catch (e) {
        blocked++;
      }
    }

    expect(allowed).toBe(burstCeiling);
    expect(blocked).toBe(5);
  });

  it('enforces corporation purchase quota (1000/day)', () => {
    const { guard } = makeGuard();
    const purchaseLimit   = ROLE_QUOTAS.corporation.purchase.limit;
    const burstCeiling    = Math.floor(purchaseLimit * BURST_MULTIPLIER);

    let blocked = 0;
    for (let i = 0; i < burstCeiling + 3; i++) {
      const ctx = makeContext({ role: 'corporation', method: 'POST', path: '/api/v1/marketplace/purchase' });
      try {
        guard.canActivate(ctx);
      } catch {
        blocked++;
      }
    }
    expect(blocked).toBe(3);
  });

  it('enforces public read quota (100/hour)', () => {
    const { guard } = makeGuard();
    const readLimit    = ROLE_QUOTAS.public.read.limit;
    const burstCeiling = Math.floor(readLimit * BURST_MULTIPLIER);

    let blocked = 0;
    for (let i = 0; i < burstCeiling + 2; i++) {
      const ctx = makeContext({ role: 'public', method: 'GET', path: '/api/v1/stats' });
      try {
        guard.canActivate(ctx);
      } catch {
        blocked++;
      }
    }
    expect(blocked).toBe(2);
  });

  it('does NOT share quotas between different roles on same IP', () => {
    const { guard } = makeGuard();
    // Corporation has a higher purchase limit — hitting public read limit should not affect it
    for (let i = 0; i < 110; i++) {
      const ctx = makeContext({ role: 'public', method: 'GET', path: '/api/v1/stats', ip: '10.0.0.1' });
      try { guard.canActivate(ctx); } catch { /* expected */ }
    }
    // A corporation user on same IP with different bucket should still get through
    const corpCtx = makeContext({ role: 'corporation', publicKey: 'corp-wallet', method: 'POST', path: '/api/v1/marketplace/purchase' });
    expect(() => guard.canActivate(corpCtx)).not.toThrow();
  });

  it('does NOT share quotas between different user identities', () => {
    const { guard } = makeGuard();
    const readLimit    = ROLE_QUOTAS.public.read.limit;
    const burstCeiling = Math.floor(readLimit * BURST_MULTIPLIER);

    // Exhaust quota for user-A
    for (let i = 0; i < burstCeiling + 1; i++) {
      const ctx = makeContext({ role: 'corporation', publicKey: 'wallet-A', method: 'GET', path: '/api/v1/stats' });
      try { guard.canActivate(ctx); } catch { /* expected at end */ }
    }

    // user-B should still have a fresh quota
    const ctxB = makeContext({ role: 'corporation', publicKey: 'wallet-B', method: 'GET', path: '/api/v1/stats' });
    expect(() => guard.canActivate(ctxB)).not.toThrow();
  });

  // ── Quota exhaustion error shape ─────────────────────────────────────────

  it('throws HttpException 429 with correct body on exhaustion', () => {
    const { guard } = makeGuard();
    const readLimit    = ROLE_QUOTAS.public.read.limit;
    const burstCeiling = Math.floor(readLimit * BURST_MULTIPLIER);

    for (let i = 0; i < burstCeiling; i++) {
      const ctx = makeContext({ role: 'public', method: 'GET', path: '/api/v1/stats' });
      try { guard.canActivate(ctx); } catch { /* ignore until last */ }
    }

    const ctx = makeContext({ role: 'public', method: 'GET', path: '/api/v1/stats' });
    try {
      guard.canActivate(ctx);
      fail('Expected HttpException to be thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      const body = (e as HttpException).getResponse() as any;
      expect(body.statusCode).toBe(429);
      expect(body.retryAfter).toBeGreaterThan(0);
      expect(body.resetAt).toBeDefined();
    }
  });

  // ── Burst allowance ──────────────────────────────────────────────────────

  it('allows burst up to 10% over base limit', () => {
    const { guard } = makeGuard();
    const readLimit    = ROLE_QUOTAS.public.read.limit;        // 100
    const burstCeiling = Math.floor(readLimit * BURST_MULTIPLIER); // 110

    let allowed = 0;
    for (let i = 0; i < burstCeiling; i++) {
      const ctx = makeContext({ role: 'public', method: 'GET', path: '/api/v1/stats' });
      try { guard.canActivate(ctx); allowed++; } catch { /* stop counting */ }
    }
    // Should allow exactly burstCeiling requests
    expect(allowed).toBe(burstCeiling);
  });

  it('blocks the first request above burst ceiling', () => {
    const { guard } = makeGuard();
    const readLimit    = ROLE_QUOTAS.public.read.limit;
    const burstCeiling = Math.floor(readLimit * BURST_MULTIPLIER);

    for (let i = 0; i < burstCeiling; i++) {
      const ctx = makeContext({ role: 'public', method: 'GET', path: '/api/v1/stats' });
      try { guard.canActivate(ctx); } catch { /* expected */ }
    }

    const ctx = makeContext({ role: 'public', method: 'GET', path: '/api/v1/stats' });
    expect(() => guard.canActivate(ctx)).toThrow(HttpException);
  });

  // ── Adaptive throttling ──────────────────────────────────────────────────

  it('halves effective limit under high load', () => {
    const { guard, monitor } = makeGuard();
    monitor._forceHighLoad(true);

    const readLimit         = ROLE_QUOTAS.public.read.limit;       // 100
    const adaptiveBase      = Math.floor(readLimit * 0.50);        // 50
    const adaptiveCeiling   = Math.floor(adaptiveBase * BURST_MULTIPLIER); // 55

    let allowed = 0;
    let blocked = 0;
    for (let i = 0; i < adaptiveCeiling + 5; i++) {
      const ctx = makeContext({ role: 'public', method: 'GET', path: '/api/v1/stats' });
      try { guard.canActivate(ctx); allowed++; } catch { blocked++; }
    }

    expect(allowed).toBe(adaptiveCeiling);
    expect(blocked).toBe(5);
  });

  it('restores normal limit when high load clears', () => {
    const { guard, monitor } = makeGuard();
    monitor._forceHighLoad(true);

    // Hit adaptive limit
    const adaptiveCeiling = Math.floor(Math.floor(ROLE_QUOTAS.public.read.limit * 0.5) * BURST_MULTIPLIER);
    for (let i = 0; i < adaptiveCeiling + 1; i++) {
      const ctx = makeContext({ role: 'public', publicKey: 'wallet-C', method: 'GET', path: '/api/v1/stats' });
      try { guard.canActivate(ctx); } catch { /* expected */ }
    }

    // Load clears — new user (fresh bucket) should get full limit
    monitor._forceHighLoad(false);
    const normalCeiling = Math.floor(ROLE_QUOTAS.public.read.limit * BURST_MULTIPLIER);
    let allowed = 0;
    for (let i = 0; i < normalCeiling; i++) {
      const ctx = makeContext({ role: 'public', publicKey: 'wallet-D', method: 'GET', path: '/api/v1/stats' });
      try { guard.canActivate(ctx); allowed++; } catch { /* stop */ }
    }
    expect(allowed).toBe(normalCeiling);
  });

  // ── AdaptiveLoadMonitor ──────────────────────────────────────────────────

  describe('AdaptiveLoadMonitor', () => {
    it('starts with isHighLoad = false', () => {
      const monitor = new AdaptiveLoadMonitor();
      expect(monitor.isHighLoad).toBe(false);
    });

    it('_forceHighLoad sets the flag immediately', () => {
      const monitor = new AdaptiveLoadMonitor();
      monitor._forceHighLoad(true);
      expect(monitor.isHighLoad).toBe(true);
      monitor._forceHighLoad(false);
      expect(monitor.isHighLoad).toBe(false);
    });

    it('currentCpuPercent returns a number between 0 and 100', () => {
      const monitor = new AdaptiveLoadMonitor();
      const pct = monitor.currentCpuPercent();
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    });
  });

  // ── QuotaStore ────────────────────────────────────────────────────────────

  describe('QuotaStore', () => {
    it('increments count correctly', () => {
      const store = new QuotaStore();
      const now   = Date.now();
      const s1    = store.increment('k:read', 3600_000, now);
      expect(s1.count).toBe(1);
      const s2 = store.increment('k:read', 3600_000, now);
      expect(s2.count).toBe(2);
    });

    it('resets window when expired', () => {
      const store = new QuotaStore();
      const past  = Date.now() - 7200_000; // 2 hours ago
      store.increment('k:read', 3600_000, past); // window expired
      const now  = Date.now();
      const s    = store.increment('k:read', 3600_000, now);
      expect(s.count).toBe(1); // fresh window
    });

    it('evictExpired removes stale keys', () => {
      const store = new QuotaStore();
      const past  = Date.now() - 7200_000;
      store.increment('stale', 3600_000, past);
      store.evictExpired(Date.now());
      const s = store.getOrInit('stale', 3600_000, Date.now());
      expect(s.count).toBe(0); // re-initialised
    });
  });

  // ── @QuotaBucket decorator ────────────────────────────────────────────────

  it('respects @QuotaBucket decorator over path inference', () => {
    const { guard } = makeGuard();
    const mintLimit    = ROLE_QUOTAS.project.mint.limit;
    const burstCeiling = Math.floor(mintLimit * BURST_MULTIPLIER);

    let blocked = 0;
    for (let i = 0; i < burstCeiling + 2; i++) {
      // Path doesn't match any override but decorator says 'mint'
      const ctx = makeContext({
        role: 'project',
        method: 'POST',
        path: '/api/v1/projects/some-custom-endpoint',
        handlerMeta: { quota_bucket: 'mint' },
      });
      try { guard.canActivate(ctx); } catch { blocked++; }
    }
    expect(blocked).toBe(2);
  });
});
