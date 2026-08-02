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
    const redisState = Array.from({ length: 25 }, () => '1');
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
});
