import { Test, TestingModule } from '@nestjs/testing';
import { TemporalService } from './temporal.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TemporalService', () => {
  let service: TemporalService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemporalService,
        {
          provide: PrismaService,
          useValue: {
            carbonProjectHistory: {
              create: jest.fn(),
              findFirst: jest.fn(),
              findMany: jest.fn(),
              deleteMany: jest.fn(),
            },
            creditBatchHistory: {
              create: jest.fn(),
              findFirst: jest.fn(),
              findMany: jest.fn(),
              deleteMany: jest.fn(),
            },
            retirementRecordHistory: {
              create: jest.fn(),
              findFirst: jest.fn(),
              findMany: jest.fn(),
              deleteMany: jest.fn(),
            },
            $queryRaw: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<TemporalService>(TemporalService);
    prisma = module.get(PrismaService) as jest.Mocked<PrismaService>;
  });

  describe('recordProjectVersion', () => {
    it('should create new project history entry without previous state', async () => {
      const projectState = {
        id: 'proj-1',
        projectId: 'proj-test',
        name: 'Test Project',
        status: 'Active',
        started_at: new Date('2026-08-01'),
        ended_at: null,
      };

      await service.recordProjectVersion('proj-test', projectState);

      expect(prisma.carbonProjectHistory.create).toHaveBeenCalledWith({
        data: {
          ...projectState,
          started_at: expect.any(Date),
          ended_at: null,
        },
      });

      expect(prisma.carbonProjectHistory.create).toHaveBeenCalledTimes(1);
    });

    it('should mark previous version as ended when updating', async () => {
      const previousState = {
        projectId: 'proj-test',
        name: 'Old Name',
        status: 'Pending',
        started_at: new Date('2026-08-01'),
        ended_at: null,
      };

      const currentState = {
        projectId: 'proj-test',
        name: 'New Name',
        status: 'Active',
        started_at: new Date('2026-08-01'),
        ended_at: null,
      };

      await service.recordProjectVersion('proj-test', currentState, previousState);

      // Should create entry for ended previous version
      expect(prisma.carbonProjectHistory.create).toHaveBeenNthCalledWith(1, {
        data: {
          ...previousState,
          ended_at: expect.any(Date),
        },
      });

      // Should create entry for new version
      expect(prisma.carbonProjectHistory.create).toHaveBeenNthCalledWith(2, {
        data: {
          ...currentState,
          started_at: expect.any(Date),
          ended_at: null,
        },
      });

      expect(prisma.carbonProjectHistory.create).toHaveBeenCalledTimes(2);
    });

    it('should handle errors gracefully', async () => {
      prisma.carbonProjectHistory.create.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(
        service.recordProjectVersion('proj-test', {})
      ).rejects.toThrow('Database error');
    });
  });

  describe('recordBatchVersion', () => {
    it('should create new batch history entry', async () => {
      const batchState = {
        batchId: 'batch-1',
        projectId: 'proj-1',
        amount: 1000,
        status: 'Active',
      };

      await service.recordBatchVersion('batch-1', batchState);

      expect(prisma.creditBatchHistory.create).toHaveBeenCalledWith({
        data: {
          ...batchState,
          started_at: expect.any(Date),
          ended_at: null,
        },
      });
    });
  });

  describe('recordRetirementVersion', () => {
    it('should create new retirement history entry', async () => {
      const retirementState = {
        retirementId: 'ret-1',
        batchId: 'batch-1',
        projectId: 'proj-1',
        amount: 500,
        status: 'retired',
      };

      await service.recordRetirementVersion('ret-1', retirementState);

      expect(prisma.retirementRecordHistory.create).toHaveBeenCalledWith({
        data: {
          ...retirementState,
          started_at: expect.any(Date),
          ended_at: null,
        },
      });
    });
  });

  describe('getStateAtTime', () => {
    it('should retrieve project state at a specific timestamp', async () => {
      const pastState = {
        projectId: 'proj-1',
        name: 'Past Name',
        status: 'Pending',
        started_at: new Date('2026-08-01'),
        ended_at: new Date('2026-08-02'),
      };

      prisma.carbonProjectHistory.findFirst.mockResolvedValue(pastState);

      const result = await service.getStateAtTime(
        'project',
        'proj-1',
        new Date('2026-08-01T12:00:00Z')
      );

      expect(result).toEqual(pastState);
      expect(prisma.carbonProjectHistory.findFirst).toHaveBeenCalledWith({
        where: {
          projectId: 'proj-1',
          started_at: { lte: expect.any(Date) },
          OR: expect.any(Array),
        },
        orderBy: { started_at: 'desc' },
      });
    });

    it('should return null if entity did not exist at timestamp', async () => {
      prisma.carbonProjectHistory.findFirst.mockResolvedValue(null);

      const result = await service.getStateAtTime(
        'project',
        'proj-1',
        new Date('2026-01-01')
      );

      expect(result).toBeNull();
    });

    it('should throw error for invalid entity type', async () => {
      await expect(
        service.getStateAtTime(
          'invalid' as any,
          'id',
          new Date()
        )
      ).rejects.toThrow('Unknown entity type');
    });
  });

  describe('getFullHistory', () => {
    it('should retrieve all versions of a project ordered by start time', async () => {
      const history = [
        {
          projectId: 'proj-1',
          name: 'Version 1',
          status: 'Pending',
          started_at: new Date('2026-08-01'),
          ended_at: new Date('2026-08-02'),
        },
        {
          projectId: 'proj-1',
          name: 'Version 2',
          status: 'Active',
          started_at: new Date('2026-08-02'),
          ended_at: null,
        },
      ];

      prisma.carbonProjectHistory.findMany.mockResolvedValue(history);

      const result = await service.getFullHistory('project', 'proj-1');

      expect(result).toEqual(history);
      expect(prisma.carbonProjectHistory.findMany).toHaveBeenCalledWith({
        where: { projectId: 'proj-1' },
        orderBy: { started_at: 'asc' },
      });
    });

    it('should return batch history', async () => {
      const history = [
        {
          batchId: 'batch-1',
          amount: 1000,
          status: 'Active',
          started_at: new Date('2026-08-01'),
          ended_at: null,
        },
      ];

      prisma.creditBatchHistory.findMany.mockResolvedValue(history);

      const result = await service.getFullHistory('batch', 'batch-1');

      expect(result).toEqual(history);
      expect(prisma.creditBatchHistory.findMany).toHaveBeenCalledWith({
        where: { batchId: 'batch-1' },
        orderBy: { started_at: 'asc' },
      });
    });
  });

  describe('getChangesInRange', () => {
    it('should retrieve all changes within a time range', async () => {
      const changes = [
        {
          projectId: 'proj-1',
          status: 'Pending',
          started_at: new Date('2026-08-01T10:00:00Z'),
        },
        {
          projectId: 'proj-1',
          status: 'Active',
          started_at: new Date('2026-08-01T14:00:00Z'),
        },
      ];

      prisma.carbonProjectHistory.findMany.mockResolvedValue(changes);

      const result = await service.getChangesInRange(
        'project',
        'proj-1',
        new Date('2026-08-01T00:00:00Z'),
        new Date('2026-08-02T00:00:00Z')
      );

      expect(result).toEqual(changes);
      expect(prisma.carbonProjectHistory.findMany).toHaveBeenCalledWith({
        where: {
          projectId: 'proj-1',
          started_at: {
            gte: expect.any(Date),
            lte: expect.any(Date),
          },
        },
        orderBy: { started_at: 'asc' },
      });
    });
  });

  describe('archiveHistoryBefore', () => {
    it('should archive project history entries older than specified date', async () => {
      prisma.carbonProjectHistory.deleteMany.mockResolvedValue({ count: 100 });

      const count = await service.archiveHistoryBefore(
        new Date('2023-12-31'),
        'project'
      );

      expect(count).toBe(100);
      expect(prisma.carbonProjectHistory.deleteMany).toHaveBeenCalledWith({
        where: {
          ended_at: { lt: expect.any(Date) },
        },
      });
    });

    it('should archive all history types when entity type is "all"', async () => {
      prisma.carbonProjectHistory.deleteMany.mockResolvedValue({ count: 50 });
      prisma.creditBatchHistory.deleteMany.mockResolvedValue({ count: 40 });
      prisma.retirementRecordHistory.deleteMany.mockResolvedValue({ count: 30 });

      const count = await service.archiveHistoryBefore(
        new Date('2023-12-31'),
        'all'
      );

      expect(count).toBe(120); // 50 + 40 + 30
      expect(prisma.carbonProjectHistory.deleteMany).toHaveBeenCalled();
      expect(prisma.creditBatchHistory.deleteMany).toHaveBeenCalled();
      expect(prisma.retirementRecordHistory.deleteMany).toHaveBeenCalled();
    });
  });

  describe('computeStorageOverhead', () => {
    it('should calculate storage overhead percentage', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { table_name: 'public.CarbonProject', size_bytes: BigInt(100) },
        { table_name: 'public.CreditBatch', size_bytes: BigInt(200) },
        { table_name: 'public.RetirementRecord', size_bytes: BigInt(300) },
        { table_name: 'public.CarbonProjectHistory', size_bytes: BigInt(150) },
        { table_name: 'public.CreditBatchHistory', size_bytes: BigInt(250) },
        { table_name: 'public.RetirementRecordHistory', size_bytes: BigInt(400) },
      ]);

      const result = await service.computeStorageOverhead();

      expect(result.activeSize).toBe(600); // 100 + 200 + 300
      expect(result.historySize).toBe(800); // 150 + 250 + 400
      expect(result.totalSize).toBe(1400); // 600 + 800
      expect(result.overheadPercentage).toBeCloseTo(57.14, 1); // 800/1400 * 100
    });

    it('should handle empty tables', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.computeStorageOverhead();

      expect(result.activeSize).toBe(0);
      expect(result.historySize).toBe(0);
      expect(result.totalSize).toBe(0);
      expect(result.overheadPercentage).toBe(0);
    });
  });
});
