import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { RolesGuard } from '../auth/roles.guard';
import { PrismaService } from '../prisma.service';

const TEST_SECRET = 'test-secret';

const prismaMock = { user: { findUnique: jest.fn() } };
const projectsServiceMock = { verify: jest.fn(), reject: jest.fn() };

describe('ProjectsController – verify/reject RBAC', () => {
  let guard: RolesGuard;
  let jwt: JwtService;
  let reflector: Reflector;

  beforeEach(async () => {
    process.env.JWT_SECRET = TEST_SECRET;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [
        RolesGuard,
        Reflector,
        { provide: JwtService, useValue: new JwtService({ secret: TEST_SECRET }) },
        { provide: PrismaService, useValue: prismaMock },
        { provide: ProjectsService, useValue: projectsServiceMock },
      ],
    }).compile();

    guard = module.get(RolesGuard);
    jwt = module.get(JwtService);
    reflector = module.get(Reflector);
  });

  afterEach(() => jest.clearAllMocks());

  function signToken(payload: object) {
    return jwt.sign(payload, { secret: TEST_SECRET });
  }

  function setupReflector(roles: string[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: any) => {
      if (key === 'isPublic') return false;
      if (key === 'roles') return roles;
      return undefined;
    });
  }

  function makeCtx(token: string) {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: `Bearer ${token}` },
          user: undefined as any,
        }),
      }),
    } as any;
  }

  it('POST /projects/:id/verify — 403 "Verifier role required" for corporation', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ publicKey: 'GCORP', role: 'corporation' });
    setupReflector(['verifier', 'admin']);
    const token = signToken({ sub: 'GCORP', role: 'corporation', type: 'access' });
    await expect(guard.canActivate(makeCtx(token))).rejects.toThrow(
      new ForbiddenException('Verifier role required'),
    );
  });

  it('POST /projects/:id/reject — 403 "Verifier role required" for corporation', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ publicKey: 'GCORP', role: 'corporation' });
    setupReflector(['verifier', 'admin']);
    const token = signToken({ sub: 'GCORP', role: 'corporation', type: 'access' });
    await expect(guard.canActivate(makeCtx(token))).rejects.toThrow(
      new ForbiddenException('Verifier role required'),
    );
  });

  it('POST /projects/:id/verify — 403 "Verifier role required" for project_developer', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ publicKey: 'GDEV', role: 'project_developer' });
    setupReflector(['verifier', 'admin']);
    const token = signToken({ sub: 'GDEV', role: 'project_developer', type: 'access' });
    await expect(guard.canActivate(makeCtx(token))).rejects.toThrow(
      new ForbiddenException('Verifier role required'),
    );
  });

  it('POST /projects/:id/verify — allows verifier role', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ publicKey: 'GVERIF', role: 'verifier' });
    setupReflector(['verifier', 'admin']);
    const token = signToken({ sub: 'GVERIF', role: 'verifier', type: 'access' });
    await expect(guard.canActivate(makeCtx(token))).resolves.toBe(true);
  });

  it('POST /projects/:id/verify — allows admin role', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ publicKey: 'GADMIN', role: 'admin' });
    setupReflector(['verifier', 'admin']);
    const token = signToken({ sub: 'GADMIN', role: 'admin', type: 'access' });
    await expect(guard.canActivate(makeCtx(token))).resolves.toBe(true);
  });
});
