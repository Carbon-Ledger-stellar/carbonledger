import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProjectsService, CallerContext } from './projects.service';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis.service';
import { MailService } from '../mail/mail.service';
import { ProjectStateMachineService } from './project-state-machine.service';
import { SearchProjectsDto, ProjectStatus, OracleFreshness } from './projects.dto';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let prisma: PrismaService;
  let redisService: any;

  const mockPrisma = {
    carbonProject: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  const mockRedisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  const mockMailService = {
    sendEmail: jest.fn(),
  };

  const mockStateMachineService = {
    transition: jest.fn(),
  };

  // ── Caller fixtures used throughout ────────────────────────────────────
  // adminCaller is used as the default for tests that are really about
  // filter/pagination/sorting logic, unrelated to RBAC — admin gets no
  // added scoping, so it preserves the original assertions unchanged.
  const adminCaller: CallerContext = { publicKey: 'GADMIN789', role: 'admin' };
  const verifierCaller: CallerContext = { publicKey: 'GVERIF456', role: 'verifier' };
  const corporationCaller: CallerContext = { publicKey: 'GCORP123', role: 'corporation' };
  // Owns mockProjects[0] (ownerAddress: '0x456')
  const ownerDeveloperCaller: CallerContext = { publicKey: '0x456', role: 'project_developer' };
  // A different developer who does NOT own mockProjects[0]
  const otherDeveloperCaller: CallerContext = { publicKey: '0xDEV999', role: 'project_developer' };

  const mockProjects = [
    {
      id: '1',
      projectId: 'proj-001',
      name: 'Amazon Reforestation',
      description: 'Large-scale reforestation project in the Amazon',
      methodology: 'VCS',
      country: 'BR',
      projectType: 'forestry',
      status: 'Verified',
      vintageYear: 2023,
      totalCreditsIssued: 1000,
      totalCreditsRetired: 300,
      metadataCid: 'QmTest123',
      verifierAddress: '0x123',
      ownerAddress: '0x456',
      coordinates: null,
      lastMonitoringAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: '2',
      projectId: 'proj-002',
      name: 'Solar Energy Project',
      description: 'Solar farm installation in California',
      methodology: 'GS',
      country: 'US',
      projectType: 'renewable',
      status: 'Pending',
      vintageYear: 2024,
      totalCreditsIssued: 500,
      totalCreditsRetired: 0,
      metadataCid: 'QmTest456',
      verifierAddress: '0x789',
      ownerAddress: '0x012',
      coordinates: null,
      lastMonitoringAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MailService, useValue: mockMailService },
        { provide: ProjectStateMachineService, useValue: mockStateMachineService },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
    prisma = module.get<PrismaService>(PrismaService);
    redisService = module.get<RedisService>(RedisService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('searchProjects', () => {
    const mockProjects = [
      {
        id: '1',
        projectId: 'proj-001',
        name: 'Amazon Reforestation',
        description: 'Large-scale reforestation project in the Amazon',
        methodology: 'VCS',
        country: 'BR',
        projectType: 'forestry',
        status: 'Verified',
        vintageYear: 2023,
        totalCreditsIssued: 1000,
        totalCreditsRetired: 300,
        metadataCid: 'QmTest123',
        verifierAddress: '0x123',
        ownerAddress: '0x456',
        coordinates: null,
        lastMonitoringAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '2',
        projectId: 'proj-002',
        name: 'Solar Energy Project',
        description: 'Solar farm installation in California',
        methodology: 'GS',
        country: 'US',
        projectType: 'renewable',
        status: 'Pending',
        vintageYear: 2024,
        totalCreditsIssued: 500,
        totalCreditsRetired: 0,
        metadataCid: 'QmTest456',
        verifierAddress: '0x789',
        ownerAddress: '0x012',
        coordinates: null,
        lastMonitoringAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    it('should return paginated projects with default parameters', async () => {
      const searchDto: SearchProjectsDto = {};

      mockPrisma.carbonProject.findMany.mockResolvedValue(mockProjects);
      mockPrisma.carbonProject.count.mockResolvedValue(2);

      const result = await service.searchProjects(searchDto, adminCaller);

      expect(result).toEqual({
        data: mockProjects,
        projects: mockProjects,
        total: 2,
        limit: 20,
        offset: 0,
        hasMore: false,
        nextOffset: null,
        nextCursor: undefined,
      });

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 21,
        cursor: undefined,
        skip: 0,
        select: expect.any(Object),
      });
    });

    it('should filter by methodology', async () => {
      const searchDto: SearchProjectsDto = { methodology: ['VCS'] };

      mockPrisma.carbonProject.findMany.mockResolvedValue([mockProjects[0]]);
      mockPrisma.carbonProject.count.mockResolvedValue(1);

      const result = await service.searchProjects(searchDto, adminCaller);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null, methodology: { in: ['VCS'] } },
        orderBy: { createdAt: 'desc' },
        take: 21,
        cursor: undefined,
        skip: 0,
        select: expect.any(Object),
      });

      expect(result.projects).toHaveLength(1);
      expect(result.projects[0].methodology).toBe('VCS');
    });

    it('should filter by country', async () => {
      const searchDto: SearchProjectsDto = { country: ['BR', 'US'] };

      mockPrisma.carbonProject.findMany.mockResolvedValue(mockProjects);
      mockPrisma.carbonProject.count.mockResolvedValue(2);

      await service.searchProjects(searchDto, adminCaller);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null, country: { in: ['BR', 'US'] } },
        orderBy: { createdAt: 'desc' },
        take: 21,
        cursor: undefined,
        skip: 0,
        select: expect.any(Object),
      });
    });

    it('should filter by status', async () => {
      const searchDto: SearchProjectsDto = { status: [ProjectStatus.VERIFIED] };

      mockPrisma.carbonProject.findMany.mockResolvedValue([mockProjects[0]]);
      mockPrisma.carbonProject.count.mockResolvedValue(1);

      const result = await service.searchProjects(searchDto, adminCaller);

      expect(result.projects).toHaveLength(1);
      expect(result.projects[0].status).toBe('Verified');
    });

    it('should filter by vintage year', async () => {
      const searchDto: SearchProjectsDto = { vintageYear: [2023, 2024] };

      mockPrisma.carbonProject.findMany.mockResolvedValue(mockProjects);
      mockPrisma.carbonProject.count.mockResolvedValue(2);

      await service.searchProjects(searchDto, adminCaller);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null, vintageYear: { in: [2023, 2024] } },
        orderBy: { createdAt: 'desc' },
        take: 21,
        cursor: undefined,
        skip: 0,
        select: expect.any(Object),
      });
    });

    it('should perform full-text search on name and description', async () => {
      const searchDto: SearchProjectsDto = { search: 'Amazon' };

      mockPrisma.carbonProject.findMany.mockResolvedValue([mockProjects[0]]);
      mockPrisma.carbonProject.count.mockResolvedValue(1);

      const result = await service.searchProjects(searchDto, adminCaller);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
          OR: [
            { name: { contains: 'Amazon', mode: 'insensitive' } },
            { description: { contains: 'Amazon', mode: 'insensitive' } }
          ]
        },
        orderBy: { createdAt: 'desc' },
        take: 21,
        cursor: undefined,
        skip: 0,
        select: expect.any(Object),
      });

      expect(result.projects).toHaveLength(1);
      expect(result.projects[0].name).toContain('Amazon');
    });

    it('should filter by oracle freshness - fresh', async () => {
      const searchDto: SearchProjectsDto = { oracleFreshness: OracleFreshness.FRESH };

      mockPrisma.carbonProject.findMany.mockResolvedValue([mockProjects[0]]);
      mockPrisma.carbonProject.count.mockResolvedValue(1);

      await service.searchProjects(searchDto, adminCaller);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
          lastMonitoringAt: {
            gte: expect.any(Date)
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 21,
        cursor: undefined,
        skip: 0,
        select: expect.any(Object),
      });
    });

    it('should filter by oracle freshness - stale', async () => {
      const searchDto: SearchProjectsDto = { oracleFreshness: OracleFreshness.STALE };

      mockPrisma.carbonProject.findMany.mockResolvedValue([mockProjects[1]]);
      mockPrisma.carbonProject.count.mockResolvedValue(1);

      await service.searchProjects(searchDto, adminCaller);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
          OR: [
            { lastMonitoringAt: { lt: expect.any(Date) } },
            { lastMonitoringAt: null }
          ]
        },
        orderBy: { createdAt: 'desc' },
        take: 21,
        cursor: undefined,
        skip: 0,
        select: expect.any(Object),
      });
    });

    it('should filter by oracle freshness - unknown', async () => {
      const searchDto: SearchProjectsDto = { oracleFreshness: OracleFreshness.UNKNOWN };

      mockPrisma.carbonProject.findMany.mockResolvedValue([mockProjects[1]]);
      mockPrisma.carbonProject.count.mockResolvedValue(1);

      await service.searchProjects(searchDto, adminCaller);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null, lastMonitoringAt: null },
        orderBy: { createdAt: 'desc' },
        take: 21,
        cursor: undefined,
        skip: 0,
        select: expect.any(Object),
      });
    });

    it('should handle cursor-based pagination', async () => {
      const searchDto: SearchProjectsDto = { cursor: '1', limit: 10 };

      mockPrisma.carbonProject.findMany.mockResolvedValue([mockProjects[1]]);
      mockPrisma.carbonProject.count.mockResolvedValue(2);

      const result = await service.searchProjects(searchDto, adminCaller);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 11,
        cursor: { id: '1' },
        skip: 1,
        select: expect.any(Object),
      });

      expect(result.nextCursor).toBeUndefined();
    });

    it('should detect when there are more results', async () => {
      const searchDto: SearchProjectsDto = { limit: 1 };

      mockPrisma.carbonProject.findMany.mockResolvedValue(mockProjects);
      mockPrisma.carbonProject.count.mockResolvedValue(2);

      const result = await service.searchProjects(searchDto, adminCaller);

      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe(mockProjects[0].id);
      expect(result.projects).toHaveLength(1);
    });

    it('should handle custom sorting', async () => {
      const searchDto: SearchProjectsDto = { sortBy: 'name', sortOrder: 'asc' };

      mockPrisma.carbonProject.findMany.mockResolvedValue(mockProjects);
      mockPrisma.carbonProject.count.mockResolvedValue(2);

      await service.searchProjects(searchDto, adminCaller);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
        take: 21,
        cursor: undefined,
        skip: 0,
        select: expect.any(Object),
      });
    });

    it('should handle multiple filters combined', async () => {
      const searchDto: SearchProjectsDto = {
        methodology: ['VCS'],
        country: ['BR'],
        status: [ProjectStatus.VERIFIED],
        vintageYear: [2023],
        search: 'Amazon'
      };

      mockPrisma.carbonProject.findMany.mockResolvedValue([mockProjects[0]]);
      mockPrisma.carbonProject.count.mockResolvedValue(1);

      const result = await service.searchProjects(searchDto, adminCaller);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
          OR: [
            { name: { contains: 'Amazon', mode: 'insensitive' } },
            { description: { contains: 'Amazon', mode: 'insensitive' } }
          ],
          methodology: { in: ['VCS'] },
          country: { in: ['BR'] },
          status: { in: ['Verified'] },
          vintageYear: { in: [2023] }
        },
        orderBy: { createdAt: 'desc' },
        take: 21,
        cursor: undefined,
        skip: 0,
        select: expect.any(Object),
      });

      expect(result.projects).toHaveLength(1);
      expect(result.projects[0].methodology).toBe('VCS');
      expect(result.projects[0].country).toBe('BR');
      expect(result.projects[0].status).toBe('Verified');
      expect(result.projects[0].vintageYear).toBe(2023);
    });

    it('should handle empty results', async () => {
      const searchDto: SearchProjectsDto = { search: 'nonexistent' };

      mockPrisma.carbonProject.findMany.mockResolvedValue([]);
      mockPrisma.carbonProject.count.mockResolvedValue(0);

      const result = await service.searchProjects(searchDto, adminCaller);

      expect(result.projects).toHaveLength(0);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeUndefined();
      expect(result.total).toBe(0);
    });
  });

  describe('findAll', () => {
    it('should work with existing findAll method (admin, unscoped)', async () => {
      const filters = { methodology: 'VCS', country: 'BR', vintage: 2023 };

      mockPrisma.carbonProject.findMany.mockResolvedValue([]);
      mockPrisma.carbonProject.count.mockResolvedValue(0);

      await service.findAll(filters, adminCaller);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
          methodology: 'VCS',
          country: 'BR',
          vintageYear: 2023,
        },
        orderBy: { createdAt: 'desc' },
        take: 21,
        cursor: undefined,
        skip: 0,
      });
    });
  });

  describe('findOne', () => {
    beforeEach(() => {
      mockPrisma.carbonProject.findFirst.mockReset();
    });

    it('should return a cached project by ID when available', async () => {
      const mockProject = mockProjects[0];
      redisService.get.mockResolvedValue(mockProject);

      const result = await service.findOne('proj-001', adminCaller);

      expect(result).toEqual(mockProject);
      expect(redisService.get).toHaveBeenCalledWith('project-detail:proj-001');
      expect(mockPrisma.carbonProject.findFirst).not.toHaveBeenCalled();
    });

    it('should cache a project on cache miss and return it', async () => {
      const mockProject = mockProjects[0];
      redisService.get.mockResolvedValue(null);
      mockPrisma.carbonProject.findFirst.mockResolvedValue(mockProject);

      const result = await service.findOne('proj-001', adminCaller);

      expect(result).toEqual(mockProject);
      expect(redisService.get).toHaveBeenCalledWith('project-detail:proj-001');
      expect(redisService.set).toHaveBeenCalledWith('project-detail:proj-001', mockProject, 60);
    });

    it('should return a project by ID', async () => {
      const mockProject = mockProjects[0];
      redisService.get.mockResolvedValue(null);
      mockPrisma.carbonProject.findFirst.mockResolvedValue(mockProject);

      const result = await service.findOne('proj-001', adminCaller);

      expect(result).toEqual(mockProject);
      expect(mockPrisma.carbonProject.findFirst).toHaveBeenCalledWith({
        where: { projectId: 'proj-001', deletedAt: null },
      });
    });

    it('should throw NotFoundException if project not found', async () => {
      redisService.get.mockResolvedValue(null);
      mockPrisma.carbonProject.findFirst.mockResolvedValue(null);

      await expect(service.findOne('nonexistent', adminCaller)).rejects.toThrow(
        'Project nonexistent not found'
      );
    });

    it('should invalidate the project cache when status changes', async () => {
      const mockProject = mockProjects[0];
      const updatedProject = { ...mockProject, status: 'Verified' };

      redisService.get.mockResolvedValue(null);
      mockPrisma.carbonProject.findFirst.mockResolvedValue(mockProject);
      mockPrisma.carbonProject.update.mockResolvedValue(updatedProject);

      const result = await service.updateStatus('proj-001', { status: 'Verified' } as any);

      expect(result).toEqual(updatedProject);
      expect(redisService.del).toHaveBeenCalledWith('project-detail:proj-001');
    });
  });

  // ── RBAC scoping — the actual point of this ticket ───────────────────────
  describe('role-based access scoping', () => {
    describe('findAll', () => {
      beforeEach(() => {
        mockPrisma.carbonProject.findMany.mockResolvedValue([]);
        mockPrisma.carbonProject.count.mockResolvedValue(0);
      });

      it('project_developer: query is scoped to their own ownerAddress', async () => {
        await service.findAll({}, ownerDeveloperCaller);

        expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ ownerAddress: ownerDeveloperCaller.publicKey }),
          }),
        );
      });

      it('verifier: query is NOT scoped by owner (full visibility)', async () => {
        await service.findAll({}, verifierCaller);

        const calledWith = mockPrisma.carbonProject.findMany.mock.calls[0][0];
        expect(calledWith.where.ownerAddress).toBeUndefined();
      });

      it('admin: query is NOT scoped by owner (full visibility)', async () => {
        await service.findAll({}, adminCaller);

        const calledWith = mockPrisma.carbonProject.findMany.mock.calls[0][0];
        expect(calledWith.where.ownerAddress).toBeUndefined();
      });

      it('corporation: query is NOT scoped by owner (full visibility)', async () => {
        await service.findAll({}, corporationCaller);

        const calledWith = mockPrisma.carbonProject.findMany.mock.calls[0][0];
        expect(calledWith.where.ownerAddress).toBeUndefined();
      });
    });

    describe('searchProjects', () => {
      beforeEach(() => {
        mockPrisma.carbonProject.findMany.mockResolvedValue([]);
        mockPrisma.carbonProject.count.mockResolvedValue(0);
      });

      it('project_developer: ownerAddress filter is combined with other filters, not replacing them', async () => {
        await service.searchProjects({ methodology: ['VCS'] }, ownerDeveloperCaller);

        expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              methodology: { in: ['VCS'] },
              ownerAddress: ownerDeveloperCaller.publicKey,
            }),
          }),
        );
      });

      it('verifier: no ownerAddress filter applied', async () => {
        await service.searchProjects({ methodology: ['VCS'] }, verifierCaller);

        const calledWith = mockPrisma.carbonProject.findMany.mock.calls[0][0];
        expect(calledWith.where.ownerAddress).toBeUndefined();
      });
    });

    describe('findOne', () => {
      it('project_developer who owns the project: returns it', async () => {
        redisService.get.mockResolvedValue(null);
        mockPrisma.carbonProject.findFirst.mockResolvedValue(mockProjects[0]); // ownerAddress: '0x456'

        const result = await service.findOne('proj-001', ownerDeveloperCaller);

        expect(result).toEqual(mockProjects[0]);
      });

      it('project_developer who does NOT own the project: throws NotFoundException (not Forbidden)', async () => {
        redisService.get.mockResolvedValue(null);
        mockPrisma.carbonProject.findFirst.mockResolvedValue(mockProjects[0]); // owned by '0x456'

        await expect(
          service.findOne('proj-001', otherDeveloperCaller),
        ).rejects.toThrow(NotFoundException);
      });

      it('verifier: can view any project regardless of owner', async () => {
        redisService.get.mockResolvedValue(null);
        mockPrisma.carbonProject.findFirst.mockResolvedValue(mockProjects[0]);

        const result = await service.findOne('proj-001', verifierCaller);

        expect(result).toEqual(mockProjects[0]);
      });

      it('corporation: can view any project regardless of owner', async () => {
        redisService.get.mockResolvedValue(null);
        mockPrisma.carbonProject.findFirst.mockResolvedValue(mockProjects[0]);

        const result = await service.findOne('proj-001', corporationCaller);

        expect(result).toEqual(mockProjects[0]);
      });

      // Regression test for the cache-bypass bug: the ownership check must run
      // on a cache HIT too, not only when the DB is actually queried. Before
      // the fix, this scenario returned the cached project to anyone, no
      // matter who was asking.
      it('cache-bypass regression: ownership check still applies when project is served from cache', async () => {
        redisService.get.mockResolvedValue(mockProjects[0]); // cache HIT, owned by '0x456'

        await expect(
          service.findOne('proj-001', otherDeveloperCaller),
        ).rejects.toThrow(NotFoundException);

        // Confirms this really was the cache path, not a DB fallback
        expect(mockPrisma.carbonProject.findFirst).not.toHaveBeenCalled();
      });
    });

    describe('findVerifiedProjects (public, unauthenticated)', () => {
      beforeEach(() => {
        mockPrisma.carbonProject.findMany.mockResolvedValue([mockProjects[0]]);
        mockPrisma.carbonProject.count.mockResolvedValue(1);
      });

      it('always filters to status = Verified', async () => {
        await service.findVerifiedProjects({});

        expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ status: 'Verified' }),
          }),
        );
      });

      it('does not select ownerAddress or verifierAddress', async () => {
        await service.findVerifiedProjects({});

        const calledWith = mockPrisma.carbonProject.findMany.mock.calls[0][0];
        expect(calledWith.select.ownerAddress).toBeUndefined();
        expect(calledWith.select.verifierAddress).toBeUndefined();
      });

      it('combines status=Verified with other filters, not overridden by them', async () => {
        await service.findVerifiedProjects({ methodology: 'VCS' });

        expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ status: 'Verified', methodology: 'VCS' }),
          }),
        );
      });
    });
  });

  describe('register', () => {
    it('should register a new project', async () => {
      const dto = {
        projectId: 'proj-003',
        name: 'New Project',
        methodology: 'VCS',
        country: 'BR',
        projectType: 'forestry',
        methodologyScore: 85,
        metadataCid: 'QmTest789',
        verifierAddress: '0x123',
        ownerAddress: '0x456',
        vintageYear: 2023,
      };

      mockPrisma.carbonProject.findFirst.mockResolvedValue(null);
      mockPrisma.carbonProject.create.mockResolvedValue({ ...dto, id: '3' });

      const result = await service.register(dto);

      expect(result).toEqual({ ...dto, id: '3' });
      expect(mockPrisma.carbonProject.create).toHaveBeenCalledWith({
        data: dto,
      });
    });

    it('should throw ConflictException if project already exists', async () => {
      const dto = {
        projectId: 'proj-001',
        name: 'Existing Project',
        methodology: 'VCS',
        country: 'BR',
        projectType: 'forestry',
        methodologyScore: 85,
        metadataCid: 'QmTest123',
        verifierAddress: '0x123',
        ownerAddress: '0x456',
        vintageYear: 2023,
      };

      mockPrisma.carbonProject.findFirst.mockResolvedValue(mockProjects[0]);

      await expect(service.register(dto)).rejects.toThrow(
        'Project proj-001 already exists'
      );
    });
  });
});