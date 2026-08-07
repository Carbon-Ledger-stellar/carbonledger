import { Test, TestingModule } from '@nestjs/testing';
import { StatsService, AggregateStats } from './stats.service';
import { PrismaService } from '../prisma.service';

describe('StatsService', () => {
  let service: StatsService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    retirementRecord: {
      aggregate: jest.fn(),
    },
    marketListing: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    carbonProject: {
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<StatsService>(StatsService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAggregateStats', () => {
    it('should return zeros when no data exists', async () => {
      mockPrismaService.retirementRecord.aggregate.mockResolvedValue({ _sum: { amount: null } });
      mockPrismaService.marketListing.count.mockResolvedValue(0);
      mockPrismaService.carbonProject.count.mockResolvedValue(0);
      mockPrismaService.marketListing.findMany.mockResolvedValue([]);

      const result = await service.getAggregateStats();

      expect(result).toEqual({
        total_co2_retired: 0,
        active_listings_count: 0,
        verified_projects_count: 0,
        total_usdc_volume: 0,
      });
    });

    it('should return correct aggregate stats when data exists', async () => {
      mockPrismaService.retirementRecord.aggregate.mockResolvedValue({
        _sum: { amount: { toNumber: () => 1000 } },
      });
      mockPrismaService.marketListing.count.mockResolvedValue(5);
      mockPrismaService.carbonProject.count.mockResolvedValue(3);
      mockPrismaService.marketListing.findMany.mockResolvedValue([
        { pricePerCredit: '10', amountAvailable: { toString: () => '50' } },
        { pricePerCredit: '20', amountAvailable: { toString: () => '25' } },
      ]);

      const result = await service.getAggregateStats();

      expect(result).toEqual({
        total_co2_retired: 1000,
        active_listings_count: 5,
        verified_projects_count: 3,
        total_usdc_volume: 1000, // (10 * 50) + (20 * 25) = 500 + 500 = 1000
      });
    });

    it('should calculate USDC volume correctly from sold listings', async () => {
      mockPrismaService.retirementRecord.aggregate.mockResolvedValue({
        _sum: { amount: null },
      });
      mockPrismaService.marketListing.count.mockResolvedValue(0);
      mockPrismaService.carbonProject.count.mockResolvedValue(0);
      mockPrismaService.marketListing.findMany.mockResolvedValue([
        { pricePerCredit: '15.5', amountAvailable: { toString: () => '100' } },
        { pricePerCredit: '25.0', amountAvailable: { toString: () => '200' } },
      ]);

      const result = await service.getAggregateStats();

      expect(result.total_usdc_volume).toBe(6550); // (15.5 * 100) + (25.0 * 200) = 1550 + 5000 = 6550
    });

    it('should use parallel queries for performance', async () => {
      mockPrismaService.retirementRecord.aggregate.mockResolvedValue({ _sum: { amount: null } });
      mockPrismaService.marketListing.count.mockResolvedValue(0);
      mockPrismaService.carbonProject.count.mockResolvedValue(0);
      mockPrismaService.marketListing.findMany.mockResolvedValue([]);

      await service.getAggregateStats();

      // All queries should be called
      expect(mockPrismaService.retirementRecord.aggregate).toHaveBeenCalled();
      expect(mockPrismaService.marketListing.count).toHaveBeenCalled();
      expect(mockPrismaService.carbonProject.count).toHaveBeenCalled();
      expect(mockPrismaService.marketListing.findMany).toHaveBeenCalled();
    });
  });
});
