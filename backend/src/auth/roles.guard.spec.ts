import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard, Roles } from './roles.guard';

/**
 * Build a mock ExecutionContext with a configurable request user.
 * A stable handler reference is returned via getHandler() so that
 * spy assertions can be made against it.
 */
function createMockContext(
  user: any,
  handlerOverride?: Function,
): ExecutionContext {
  const handler = handlerOverride ?? function defaultHandler() {};
  return {
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('RolesGuard', () => {
  let reflector: jest.Mocked<Reflector>;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = {
      get: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;
    guard = new RolesGuard(reflector);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── No metadata / public routes ──────────────────────────────────────────

  describe('when no roles metadata is defined (public routes)', () => {
    it('returns true when metadata is undefined (no @Roles decorator)', () => {
      reflector.get.mockReturnValue(undefined);
      expect(guard.canActivate(createMockContext(null))).toBe(true);
    });

    it('returns true when metadata is null', () => {
      reflector.get.mockReturnValue(null as any);
      expect(guard.canActivate(createMockContext(null))).toBe(true);
    });

    it('returns true when metadata is an empty array', () => {
      reflector.get.mockReturnValue([]);
      expect(guard.canActivate(createMockContext(null))).toBe(true);
    });

    it('does NOT inspect the user when the roles array is empty', () => {
      reflector.get.mockReturnValue([]);
      // Even with no user at all this must pass — public route
      expect(guard.canActivate(createMockContext(undefined))).toBe(true);
    });

    it('does NOT throw even when the request has no user and roles array is empty', () => {
      reflector.get.mockReturnValue([]);
      expect(() => guard.canActivate(createMockContext(undefined))).not.toThrow();
    });
  });

  // ── Authorized access ────────────────────────────────────────────────────

  describe('when the user has the required role', () => {
    it('returns true when user.role matches the single allowed role', () => {
      reflector.get.mockReturnValue(['admin']);
      const ctx = createMockContext({ publicKey: 'GABC', role: 'admin' });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('returns true when user role is the first of multiple allowed roles', () => {
      reflector.get.mockReturnValue(['admin', 'verifier', 'oracle']);
      const ctx = createMockContext({ publicKey: 'GABC', role: 'admin' });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('returns true when user role is the last of multiple allowed roles', () => {
      reflector.get.mockReturnValue(['admin', 'verifier', 'oracle']);
      const ctx = createMockContext({ publicKey: 'GABC', role: 'oracle' });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('returns true when user role is in the middle of multiple allowed roles', () => {
      reflector.get.mockReturnValue(['admin', 'verifier', 'oracle']);
      const ctx = createMockContext({ publicKey: 'GABC', role: 'verifier' });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('returns true for a single-role list with the exact matching role', () => {
      reflector.get.mockReturnValue(['oracle']);
      const ctx = createMockContext({ publicKey: 'GORACLE', role: 'oracle' });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('returns true with a two-role list and matching the second role', () => {
      reflector.get.mockReturnValue(['admin', 'verifier']);
      const ctx = createMockContext({ publicKey: 'GVERIFY', role: 'verifier' });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  // ── Unauthorized access ──────────────────────────────────────────────────

  describe('when the user does not have the required role', () => {
    it('throws ForbiddenException when user.role is not in the allowed list', () => {
      reflector.get.mockReturnValue(['admin']);
      const ctx = createMockContext({ publicKey: 'GABC', role: 'user' });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('throws with message "Insufficient permissions"', () => {
      reflector.get.mockReturnValue(['admin']);
      const ctx = createMockContext({ publicKey: 'GABC', role: 'user' });
      expect(() => guard.canActivate(ctx)).toThrow('Insufficient permissions');
    });

    it('throws when user has none of multiple allowed roles', () => {
      reflector.get.mockReturnValue(['admin', 'verifier']);
      const ctx = createMockContext({ publicKey: 'GABC', role: 'oracle' });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('is case-sensitive — "ADMIN" does not match allowed "admin"', () => {
      reflector.get.mockReturnValue(['admin']);
      const ctx = createMockContext({ publicKey: 'GABC', role: 'ADMIN' });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('is case-sensitive — "Admin" does not match allowed "admin"', () => {
      reflector.get.mockReturnValue(['admin']);
      const ctx = createMockContext({ publicKey: 'GABC', role: 'Admin' });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('is case-sensitive — "VERIFIER" does not match allowed "verifier"', () => {
      reflector.get.mockReturnValue(['verifier']);
      const ctx = createMockContext({ publicKey: 'GABC', role: 'VERIFIER' });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });

  // ── Null / undefined / incomplete user ───────────────────────────────────

  describe('edge cases — null or incomplete user object', () => {
    it('throws ForbiddenException when user is null', () => {
      reflector.get.mockReturnValue(['admin']);
      expect(() => guard.canActivate(createMockContext(null))).toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when user is undefined', () => {
      reflector.get.mockReturnValue(['admin']);
      expect(() => guard.canActivate(createMockContext(undefined))).toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when user object exists but has no role property', () => {
      reflector.get.mockReturnValue(['admin']);
      // role is absent — user.role will be undefined
      expect(() =>
        guard.canActivate(createMockContext({ publicKey: 'GABC' })),
      ).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when user.role is null', () => {
      reflector.get.mockReturnValue(['admin']);
      expect(() =>
        guard.canActivate(createMockContext({ publicKey: 'GABC', role: null })),
      ).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when user.role is an empty string', () => {
      reflector.get.mockReturnValue(['admin']);
      expect(() =>
        guard.canActivate(createMockContext({ publicKey: 'GABC', role: '' })),
      ).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when user.role is 0 (falsy non-string)', () => {
      reflector.get.mockReturnValue(['admin']);
      expect(() =>
        guard.canActivate(createMockContext({ publicKey: 'GABC', role: 0 })),
      ).toThrow(ForbiddenException);
    });

    it('includes "Insufficient permissions" in the message for null user', () => {
      reflector.get.mockReturnValue(['admin']);
      expect(() => guard.canActivate(createMockContext(null))).toThrow(
        'Insufficient permissions',
      );
    });
  });

  // ── Reflector metadata interaction ───────────────────────────────────────

  describe('Reflector metadata interaction', () => {
    it('calls reflector.get with the key "roles"', () => {
      reflector.get.mockReturnValue(['admin']);
      const ctx = createMockContext({ role: 'admin' });
      guard.canActivate(ctx);
      expect(reflector.get).toHaveBeenCalledWith('roles', expect.any(Function));
    });

    it('calls reflector.get with the exact handler returned by context.getHandler()', () => {
      reflector.get.mockReturnValue(['admin']);
      const handler = function specificHandler() {};
      const ctx = createMockContext({ role: 'admin' }, handler);
      guard.canActivate(ctx);
      expect(reflector.get).toHaveBeenCalledWith('roles', handler);
    });

    it('calls reflector.get exactly once per canActivate call', () => {
      reflector.get.mockReturnValue(undefined);
      guard.canActivate(createMockContext({ role: 'admin' }));
      expect(reflector.get).toHaveBeenCalledTimes(1);
    });

    it('calls reflector.get exactly once even when access is denied', () => {
      reflector.get.mockReturnValue(['admin']);
      try {
        guard.canActivate(createMockContext({ role: 'user' }));
      } catch {
        // expected
      }
      expect(reflector.get).toHaveBeenCalledTimes(1);
    });

    it('reads metadata from handlerA and handlerB independently', () => {
      const handlerA = function routeA() {};
      const handlerB = function routeB() {};

      reflector.get.mockImplementation((_key, handler) => {
        if (handler === handlerA) return ['admin'];
        if (handler === handlerB) return ['verifier'];
        return undefined;
      });

      const ctxA = {
        getHandler: () => handlerA,
        switchToHttp: () => ({
          getRequest: () => ({ user: { role: 'admin' } }),
        }),
      } as unknown as ExecutionContext;

      const ctxB = {
        getHandler: () => handlerB,
        switchToHttp: () => ({
          getRequest: () => ({ user: { role: 'admin' } }),
        }),
      } as unknown as ExecutionContext;

      // admin is allowed on handlerA
      expect(guard.canActivate(ctxA)).toBe(true);
      // admin is NOT in ['verifier'] on handlerB → throws
      expect(() => guard.canActivate(ctxB)).toThrow(ForbiddenException);
    });

    it('passes the "roles" string (not a symbol or other key) to Reflector', () => {
      reflector.get.mockReturnValue(undefined);
      guard.canActivate(createMockContext(null));
      const [key] = reflector.get.mock.calls[0];
      expect(key).toBe('roles');
      expect(typeof key).toBe('string');
    });
  });

  // ── @Roles decorator ─────────────────────────────────────────────────────

  describe('@Roles decorator', () => {
    it('defines "roles" metadata on the decorated method', () => {
      class TestController {
        @Roles('admin', 'verifier')
        protectedRoute() {}
      }
      const metadata = Reflect.getMetadata(
        'roles',
        new TestController().protectedRoute,
      );
      expect(metadata).toEqual(['admin', 'verifier']);
    });

    it('defines metadata with a single role', () => {
      class TestController {
        @Roles('oracle')
        oracleRoute() {}
      }
      const metadata = Reflect.getMetadata(
        'roles',
        new TestController().oracleRoute,
      );
      expect(metadata).toEqual(['oracle']);
    });

    it('defines an empty array when no roles are passed', () => {
      class TestController {
        @Roles()
        publicRoute() {}
      }
      const metadata = Reflect.getMetadata(
        'roles',
        new TestController().publicRoute,
      );
      expect(metadata).toEqual([]);
    });

    it('preserves the original function reference after decoration', () => {
      class TestController {
        @Roles('admin')
        route() {
          return 'value';
        }
      }
      expect(new TestController().route()).toBe('value');
    });

    it('supports multiple independent decorators on different methods', () => {
      class TestController {
        @Roles('admin')
        adminRoute() {}

        @Roles('verifier')
        verifierRoute() {}
      }
      const c = new TestController();
      expect(Reflect.getMetadata('roles', c.adminRoute)).toEqual(['admin']);
      expect(Reflect.getMetadata('roles', c.verifierRoute)).toEqual([
        'verifier',
      ]);
    });
  });

  // ── ForbiddenException shape ─────────────────────────────────────────────

  describe('ForbiddenException response shape', () => {
    it('thrown error is an instance of ForbiddenException', () => {
      reflector.get.mockReturnValue(['admin']);
      try {
        guard.canActivate(createMockContext({ role: 'user' }));
        fail('expected ForbiddenException to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
      }
    });

    it('carries HTTP status 403', () => {
      reflector.get.mockReturnValue(['admin']);
      try {
        guard.canActivate(createMockContext({ role: 'user' }));
        fail('expected ForbiddenException to be thrown');
      } catch (err: any) {
        expect(err.getStatus()).toBe(403);
      }
    });

    it('response body contains message "Insufficient permissions"', () => {
      reflector.get.mockReturnValue(['admin']);
      try {
        guard.canActivate(createMockContext(null));
        fail('expected ForbiddenException to be thrown');
      } catch (err: any) {
        const response = err.getResponse() as Record<string, any>;
        expect(response.message).toBe('Insufficient permissions');
      }
    });

    it('response body contains statusCode 403', () => {
      reflector.get.mockReturnValue(['admin']);
      try {
        guard.canActivate(createMockContext(null));
        fail('expected ForbiddenException to be thrown');
      } catch (err: any) {
        const response = err.getResponse() as Record<string, any>;
        expect(response.statusCode).toBe(403);
      }
    });

    it('response body contains error "Forbidden"', () => {
      reflector.get.mockReturnValue(['admin']);
      try {
        guard.canActivate(createMockContext(null));
        fail('expected ForbiddenException to be thrown');
      } catch (err: any) {
        const response = err.getResponse() as Record<string, any>;
        expect(response.error).toBe('Forbidden');
      }
    });
  });
});
