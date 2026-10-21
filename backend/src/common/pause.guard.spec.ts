import { ExecutionContext, HttpStatus, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PauseGuard,
  PauseMiddleware,
  BYPASS_PAUSE_KEY,
  getContractPauseStatus,
  createPauseConflictException,
} from './pause.guard';

describe('PauseGuard & PauseMiddleware (#1224)', () => {
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
  });

  function createMockExecutionContext(options: {
    method?: string;
    url?: string;
    user?: { role: string; publicKey?: string };
    bypass?: boolean;
  }): ExecutionContext {
    const { method = 'GET', url = '/api/v1/credits/mint', user, bypass = false } = options;

    const request = {
      method,
      url,
      originalUrl: url,
      user,
    };

    const handler = () => {};
    const targetClass = class {};

    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === BYPASS_PAUSE_KEY) return bypass;
      return undefined;
    });

    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() }),
      }),
      getHandler: () => handler,
      getClass: () => targetClass,
    } as unknown as ExecutionContext;
  }

  function createMockPrisma(isPaused: boolean, reason: string | null = null) {
    return {
      contractSyncState: {
        findFirst: jest.fn().mockResolvedValue(
          isPaused
            ? {
                isPaused: true,
                pauseReason: reason,
                pausedUntil: new Date(Date.now() + 3600_000),
              }
            : null,
        ),
      },
      adminConfig: {
        findMany: jest.fn().mockResolvedValue([
          { key: 'carbon_credit_paused', value: String(isPaused) },
          { key: 'carbon_credit_paused_until', value: String(Math.floor(Date.now() / 1000) + 3600) },
          { key: 'carbon_credit_reason', value: reason ?? '' },
        ]),
      },
    } as any;
  }

  describe('getContractPauseStatus helper', () => {
    it('returns false when prisma is not provided', async () => {
      const res = await getContractPauseStatus(null);
      expect(res.is_paused).toBe(false);
    });

    it('returns true and reason when contractSyncState is paused', async () => {
      const prisma = createMockPrisma(true, 'Exploit mitigation');
      const res = await getContractPauseStatus(prisma);
      expect(res.is_paused).toBe(true);
      expect(res.pause_reason).toBe('Exploit mitigation');
    });

    it('returns false when contract is active', async () => {
      const prisma = createMockPrisma(false);
      const res = await getContractPauseStatus(prisma);
      expect(res.is_paused).toBe(false);
      expect(res.pause_reason).toBeNull();
    });
  });

  describe('createPauseConflictException', () => {
    it('returns 409 HttpException with explanation and pause_reason', () => {
      const err = createPauseConflictException('Scheduled maintenance');
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(err.getStatus()).toBe(409);

      const resp = err.getResponse() as any;
      expect(resp.statusCode).toBe(409);
      expect(resp.error).toBe('Conflict');
      expect(resp.message).toContain('Scheduled maintenance');
      expect(resp.pause_reason).toBe('Scheduled maintenance');
    });
  });

  describe('PauseGuard', () => {
    it('allows read-only / safe HTTP methods (GET, HEAD, OPTIONS) even when contract is paused', async () => {
      const prisma = createMockPrisma(true, 'Emergency halt');
      const guard = new PauseGuard(reflector, prisma);

      for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        const ctx = createMockExecutionContext({ method, url: '/api/v1/credits' });
        const result = await guard.canActivate(ctx);
        expect(result).toBe(true);
      }
    });

    it('allows state-mutating requests (POST, PUT, DELETE, PATCH) when contract is NOT paused', async () => {
      const prisma = createMockPrisma(false);
      const guard = new PauseGuard(reflector, prisma);

      for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
        const ctx = createMockExecutionContext({ method, url: '/api/v1/credits/mint' });
        const result = await guard.canActivate(ctx);
        expect(result).toBe(true);
      }
    });

    it('rejects state-mutating requests (POST, PUT, DELETE, PATCH) with 409 Conflict when contract IS paused', async () => {
      const prisma = createMockPrisma(true, 'Contract paused for upgrade');
      const guard = new PauseGuard(reflector, prisma);

      for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
        const ctx = createMockExecutionContext({ method, url: '/api/v1/credits/mint' });
        await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);

        try {
          await guard.canActivate(ctx);
        } catch (err: any) {
          expect(err.getStatus()).toBe(409);
          expect(err.getResponse().statusCode).toBe(409);
          expect(err.getResponse().message).toContain('Contract paused for upgrade');
          expect(err.getResponse().pause_reason).toBe('Contract paused for upgrade');
        }
      }
    });

    it('bypasses pause check for admin operations (url contains /admin)', async () => {
      const prisma = createMockPrisma(true, 'Security incident');
      const guard = new PauseGuard(reflector, prisma);

      const ctx = createMockExecutionContext({ method: 'POST', url: '/admin/unpause' });
      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
    });

    it('bypasses pause check when user role is admin', async () => {
      const prisma = createMockPrisma(true, 'Security incident');
      const guard = new PauseGuard(reflector, prisma);

      const ctx = createMockExecutionContext({
        method: 'POST',
        url: '/api/v1/credits/mint',
        user: { role: 'admin' },
      });
      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
    });

    it('bypasses pause check when @BypassPause decorator is set', async () => {
      const prisma = createMockPrisma(true, 'Security incident');
      const guard = new PauseGuard(reflector, prisma);

      const ctx = createMockExecutionContext({
        method: 'POST',
        url: '/api/v1/credits/mint',
        bypass: true,
      });
      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
    });

    it('bypasses pause check for auth routes (/auth)', async () => {
      const prisma = createMockPrisma(true, 'Security incident');
      const guard = new PauseGuard(reflector, prisma);

      const ctx = createMockExecutionContext({
        method: 'POST',
        url: '/auth/login',
      });
      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
    });
  });

  describe('PauseMiddleware', () => {
    it('calls next() for safe HTTP methods', async () => {
      const prisma = createMockPrisma(true);
      const middleware = new PauseMiddleware(prisma);

      const req: any = { method: 'GET', url: '/credits' };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await middleware.use(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('returns 409 Conflict for mutating methods when paused', async () => {
      const prisma = createMockPrisma(true, 'Emergency halt');
      const middleware = new PauseMiddleware(prisma);

      const req: any = { method: 'POST', url: '/marketplace/purchase' };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await middleware.use(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 409,
          error: 'Conflict',
          pause_reason: 'Emergency halt',
        }),
      );
    });

    it('bypasses admin requests in middleware', async () => {
      const prisma = createMockPrisma(true);
      const middleware = new PauseMiddleware(prisma);

      const req: any = { method: 'POST', url: '/admin/unpause', user: { role: 'admin' } };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await middleware.use(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
