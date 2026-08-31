import { ExecutionContext } from '@nestjs/common';
import { RedisSlidingWindowRateLimitGuard } from './redis-sliding-window-rate-limit.guard';

describe('RedisSlidingWindowRateLimitGuard', () => {
  it('adds standard rate limit headers for allowed traffic', async () => {
    const redisState: string[] = [];
    const redisService = {
      getClient: () => ({
        lrange: async () => redisState,
        ltrim: async () => undefined,
        rpush: async (_key: string, value: string) => { redisState.push(value); },
        expire: async () => undefined,
      }),
    } as any;

    const guard = new RedisSlidingWindowRateLimitGuard(redisService);
    const req = { path: '/health', ip: '127.0.0.1' } as any;
    const res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;

    const context = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', expect.any(String));
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', expect.any(String));
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(String));
  });

  it('returns 429 for exhausted financial traffic', async () => {
    // Timestamps must fall inside the current window to be counted — a
    // literal "1" (1ms since epoch) sits far outside any realistic window
    // and the guard correctly discards it as stale, which is why this
    // fixture must use recent (now-ish) timestamps instead.
    const recent = Date.now() - 1_000;
    const redisState = Array.from({ length: 25 }, () => String(recent));
    const redisService = {
      getClient: () => ({
        lrange: async () => redisState,
        ltrim: async () => undefined,
        rpush: async () => undefined,
        expire: async () => undefined,
      }),
    } as any;

    const guard = new RedisSlidingWindowRateLimitGuard(redisService);
    const req = { path: '/api/v1/marketplace/purchase', ip: '127.0.0.1', user: { publicKey: 'abc' } } as any;
    const res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;

    const context = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(false);
    expect(res.status).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });

  it('bypasses the limit entirely for admin users, even over quota (#960)', async () => {
    const redisState = Array.from({ length: 999 }, () => String(Date.now()));
    const redisService = {
      getClient: () => ({
        lrange: async () => redisState,
        ltrim: async () => undefined,
        rpush: async () => undefined,
        expire: async () => undefined,
      }),
    } as any;

    const guard = new RedisSlidingWindowRateLimitGuard(redisService);
    const req = {
      path: '/api/v1/marketplace/purchase',
      ip: '127.0.0.1',
      user: { publicKey: 'admin-wallet', role: 'admin' },
    } as any;
    const res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;

    const context = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Bypass', 'admin');
  });
});
