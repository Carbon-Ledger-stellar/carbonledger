import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { PrismaService } from '../prisma.service';
import { ListingsCacheService } from './listings-cache.service';
import { MarketplaceContractService } from './marketplace-contract.service';
import { CreateListingDto } from './marketplace.dto';

describe('MarketplaceService - Batch Endpoints', () => {
  let service: MarketplaceService;

  const mockPrismaService = {
    marketListing: {
      create: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(mockPrismaService)),
  };

  const mockCacheService = {
    get: jest.fn(),
    set: jest.fn(),
    invalidateAll: jest.fn().mockResolvedValue(true),
  };

  const mockContractService = {
    verifyCreditBatchOwnership: jest.fn().mockResolvedValue(true),
    listCredits: jest.fn().mockResolvedValue('stub-tx-hash'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketplaceService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ListingsCacheService, useValue: mockCacheService },
        { provide: MarketplaceContractService, useValue: mockContractService },
      ],
    }).compile();

    service = module.get<MarketplaceService>(MarketplaceService);
  });

  describe('batchCreateListings', () => {
    it('should create multiple listings in a transaction when caller owns batches', async () => {
      const items: Array<CreateListingDto & { seller: string }> = [
        {
          listingId: 'list-001',
          projectId: 'proj-1',
          credit_batch_id: 'batch-001',
          amount: 50,
          price_per_tonne: '25.00',
          vintageYear: 2024,
          methodology: 'VM0007',
          country: 'Kenya',
          seller: 'GSELLERKEY',
        },
      ];

      mockPrismaService.marketListing.create.mockImplementation(({ data }: any) => {
        return Promise.resolve({ ...data, id: 'cuid-1' });
      });

      const result = await service.batchCreateListings(items);

      expect(result.success).toBe(true);
      expect(result.totalProcessed).toBe(1);
      expect(result.results[0].status).toBe('success');
      expect(mockContractService.verifyCreditBatchOwnership).toHaveBeenCalledWith('batch-001', 'GSELLERKEY');
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should throw ForbiddenException if caller does not own a batch', async () => {
      mockContractService.verifyCreditBatchOwnership.mockResolvedValueOnce(false);

      const items: Array<CreateListingDto & { seller: string }> = [
        {
          listingId: 'list-001',
          projectId: 'proj-1',
          credit_batch_id: 'batch-001',
          amount: 50,
          price_per_tonne: '25.00',
          vintageYear: 2024,
          methodology: 'VM0007',
          country: 'Kenya',
          seller: 'GSELLERKEY',
        },
      ];

      await expect(service.batchCreateListings(items)).rejects.toThrow(ForbiddenException);
    });
  });
});
