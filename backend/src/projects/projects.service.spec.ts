import { Test, TestingModule } from '@nestjs/testing';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma.service';
import { SearchProjectsDto, ProjectStatus, OracleFreshness } from './projects.dto';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let prisma: PrismaService;

  const mockPrisma = {
    carbonProject: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
    prisma = module.get<PrismaService>(PrismaService);
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

      const result = await service.searchProjects(searchDto);

      expect(result).toEqual({
        projects: mockProjects,
        nextCursor: undefined,
        hasMore: false,
        total: 2,
      });

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: {},
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

      const result = await service.searchProjects(searchDto);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: { methodology: { in: ['VCS'] } },
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

      await service.searchProjects(searchDto);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: { country: { in: ['BR', 'US'] } },
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

      const result = await service.searchProjects(searchDto);

      expect(result.projects).toHaveLength(1);
      expect(result.projects[0].status).toBe('Verified');
    });

    it('should filter by vintage year', async () => {
      const searchDto: SearchProjectsDto = { vintageYear: [2023, 2024] };

      mockPrisma.carbonProject.findMany.mockResolvedValue(mockProjects);
      mockPrisma.carbonProject.count.mockResolvedValue(2);

      await service.searchProjects(searchDto);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: { vintageYear: { in: [2023, 2024] } },
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

      const result = await service.searchProjects(searchDto);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: {
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

      await service.searchProjects(searchDto);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: {
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

      await service.searchProjects(searchDto);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: {
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

      await service.searchProjects(searchDto);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: { lastMonitoringAt: null },
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

      const result = await service.searchProjects(searchDto);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'desc' },
        take: 11,
        cursor: { id: '1' },
        skip: 1,
        select: expect.any(Object),
      });

      expect(result.nextCursor).toBe(mockProjects[1].id);
    });

    it('should detect when there are more results', async () => {
      const searchDto: SearchProjectsDto = { limit: 1 };

      mockPrisma.carbonProject.findMany.mockResolvedValue(mockProjects);
      mockPrisma.carbonProject.count.mockResolvedValue(2);

      const result = await service.searchProjects(searchDto);

      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe(mockProjects[0].id);
      expect(result.projects).toHaveLength(1);
    });

    it('should handle custom sorting', async () => {
      const searchDto: SearchProjectsDto = { sortBy: 'name', sortOrder: 'asc' };

      mockPrisma.carbonProject.findMany.mockResolvedValue(mockProjects);
      mockPrisma.carbonProject.count.mockResolvedValue(2);

      await service.searchProjects(searchDto);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: {},
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

      const result = await service.searchProjects(searchDto);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: {
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

      const result = await service.searchProjects(searchDto);

      expect(result.projects).toHaveLength(0);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeUndefined();
      expect(result.total).toBe(0);
    });
  });

  describe('findAll (backward compatibility)', () => {
    it('should work with existing findAll method', async () => {
      const filters = { methodology: 'VCS', country: 'BR', vintage: 2023 };

      mockPrisma.carbonProject.findMany.mockResolvedValue([]);

      await service.findAll(filters);

      expect(mockPrisma.carbonProject.findMany).toHaveBeenCalledWith({
        where: {
          methodology: 'VCS',
          country: 'BR',
          vintageYear: 2023,
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOne', () => {
    it('should return a project by ID', async () => {
      const mockProject = mockProjects[0];
      mockPrisma.carbonProject.findUnique.mockResolvedValue(mockProject);

      const result = await service.findOne('proj-001');

      expect(result).toEqual(mockProject);
      expect(mockPrisma.carbonProject.findUnique).toHaveBeenCalledWith({
        where: { projectId: 'proj-001' },
      });
    });

    it('should throw NotFoundException if project not found', async () => {
      mockPrisma.carbonProject.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        'Project nonexistent not found'
      );
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
        metadataCid: 'QmTest789',
        verifierAddress: '0x123',
        ownerAddress: '0x456',
        vintageYear: 2023,
      };

      mockPrisma.carbonProject.findUnique.mockResolvedValue(null);
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
        metadataCid: 'QmTest123',
        verifierAddress: '0x123',
        ownerAddress: '0x456',
        vintageYear: 2023,
      };

      mockPrisma.carbonProject.findUnique.mockResolvedValue(mockProjects[0]);

      await expect(service.register(dto)).rejects.toThrow(
        'Project proj-001 already exists'
      );
    });
  });
});
