import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { RolesGuard } from './roles.guard';
import { PrismaService } from '../prisma.service';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';

const TEST_SECRET = 'test-secret';

const prismaMock = { user: { findUnique: jest.fn() } };

function makeContext(overrides: {
  token?: string;
  isPublic?: boolean;
  roles?: string[];
}): ExecutionContext {
  const getHandler = jest.fn();
  const getClass = jest.fn();
  return {
    getHandler,
    getClass,
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { authorization: overrides.token ? `Bearer ${overrides.token}` : undefined },
        user: undefined as any,
      }),
    }),
    // Reflector.getAllAndOverride will call getHandler/getClass
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let jwt: JwtService;
  let reflector: Reflector;

  beforeEach(async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    process.env.JWT_ISSUER = 'carbonledger';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        Reflector,
        { provide: JwtService, useValue: new JwtService({ secret: TEST_SECRET }) },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    guard = module.get(RolesGuard);
    jwt = module.get(JwtService);
    reflector = module.get(Reflector);
  });

  afterEach(() => jest.clearAllMocks());

  function signToken(payload: object) {
    return jwt.sign(payload, { issuer: 'carbonledger' });
  }

  function setupReflector(isPublic: boolean | undefined, roles: string[] | undefined) {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((metadataKey: unknown) => {
      if (metadataKey === IS_PUBLIC_KEY) return isPublic;
      if (metadataKey === ROLES_KEY) return roles;
      return undefined;
    });
  }

  it('allows public routes without a token', async () => {
    setupReflector(true, undefined);
    const ctx = makeContext({});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws 401 when no token is provided on a protected route', async () => {
    setupReflector(false, undefined);
    const ctx = makeContext({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws 401 for an invalid token', async () => {
    setupReflector(false, undefined);
    const ctx = makeContext({ token: 'garbage.token' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws 401 when a refresh token is used as bearer', async () => {
    setupReflector(false, undefined);
    const token = signToken({ sub: 'GKEY', role: 'corporation', type: 'refresh' });
    const ctx = makeContext({ token });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws 401 when user is not found in DB', async () => {
    setupReflector(false, undefined);
    prismaMock.user.findUnique.mockResolvedValue(null);
    const token = signToken({ sub: 'GKEY', role: 'corporation', type: 'access' });
    const ctx = makeContext({ token });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('allows any authenticated user when no @Roles declared', async () => {
    setupReflector(false, undefined);
    prismaMock.user.findUnique.mockResolvedValue({ publicKey: 'GKEY', role: 'corporation' });
    const token = signToken({ sub: 'GKEY', role: 'corporation', type: 'access' });
    const ctx = makeContext({ token });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('allows access when user role matches @Roles', async () => {
    setupReflector(false, ['verifier', 'admin']);
    prismaMock.user.findUnique.mockResolvedValue({ publicKey: 'GKEY', role: 'verifier' });
    const token = signToken({ sub: 'GKEY', role: 'verifier', type: 'access' });
    const ctx = makeContext({ token });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws 403 when user role does not match @Roles', async () => {
    setupReflector(false, ['verifier', 'admin']);
    prismaMock.user.findUnique.mockResolvedValue({ publicKey: 'GKEY', role: 'corporation' });
    const token = signToken({ sub: 'GKEY', role: 'corporation', type: 'access' });
    const ctx = makeContext({ token });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('uses DB role, not JWT role claim', async () => {
    // JWT says corporation, DB says admin — DB wins
    setupReflector(false, ['admin']);
    prismaMock.user.findUnique.mockResolvedValue({ publicKey: 'GKEY', role: 'admin' });
    const token = signToken({ sub: 'GKEY', role: 'corporation', type: 'access' });
    const ctx = makeContext({ token });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('denies when JWT says admin but DB says corporation', async () => {
    setupReflector(false, ['admin']);
    prismaMock.user.findUnique.mockResolvedValue({ publicKey: 'GKEY', role: 'corporation' });
    const token = signToken({ sub: 'GKEY', role: 'admin', type: 'access' });
    const ctx = makeContext({ token });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});
