import { Test } from '@nestjs/testing';
import { MarketplaceService } from './marketplace.service';
import { PrismaService } from '../prisma.service';
import { ListingsCacheService } from './listings-cache.service';
import { MarketplaceContractService } from './marketplace-contract.service';

const mockPrisma = {
  marketListing: {
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
  },
};

const mockCache = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  invalidateAll: jest.fn().mockResolvedValue(undefined),
};

const mockContractService = {};

function listing(overrides: Partial<any>): any {
  return {
    id: overrides.id ?? 'row-id',
    listingId: overrides.listingId ?? 'L1',
    projectId: 'P1',
    batchId: 'B1',
    seller: 'GSELLER',
    amountAvailable: 10,
    pricePerCredit: '10',
    vintageYear: 2022,
    methodology: 'VCS',
    country: 'Brazil',
    status: 'Active',
    project: { name: 'Test Project' },
    ...overrides,
  };
}

describe('MarketplaceService — sorting', () => {
  let service: MarketplaceService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MarketplaceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ListingsCacheService, useValue: mockCache },
        { provide: MarketplaceContractService, useValue: mockContractService },
      ],
    }).compile();
    service = module.get(MarketplaceService);
    jest.clearAllMocks();
    mockCache.get.mockResolvedValue(null);
  });

  it('maps the project relation to a flat projectName field', async () => {
    mockPrisma.marketListing.findMany.mockResolvedValue([listing({ listingId: 'L1' })]);
    mockPrisma.marketListing.count.mockResolvedValue(1);

    const result = await service.findAll({ limit: 20 } as any);

    expect(result.listings[0].projectName).toBe('Test Project');
    expect(result.listings[0].project).toBeUndefined();
  });

  it('sorts by vintageYear via a native Prisma orderBy (descending default when no sortBy given)', async () => {
    mockPrisma.marketListing.findMany.mockResolvedValue([]);
    mockPrisma.marketListing.count.mockResolvedValue(0);

    await service.findAll({ limit: 20 } as any);

    expect(mockPrisma.marketListing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ vintageYear: 'desc' }, { createdAt: 'desc' }] }),
    );
  });

  it('sorts by vintageYear ascending when requested', async () => {
    mockPrisma.marketListing.findMany.mockResolvedValue([]);
    mockPrisma.marketListing.count.mockResolvedValue(0);

    await service.findAll({ limit: 20, sortBy: 'vintageYear', sortOrder: 'asc' } as any);

    expect(mockPrisma.marketListing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ vintageYear: 'asc' }] }),
    );
  });

  it('sorts by methodology alphabetically', async () => {
    mockPrisma.marketListing.findMany.mockResolvedValue([]);
    mockPrisma.marketListing.count.mockResolvedValue(0);

    await service.findAll({ limit: 20, sortBy: 'methodology', sortOrder: 'desc' } as any);

    expect(mockPrisma.marketListing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ methodology: 'desc' }] }),
    );
  });

  it('sorts by verification date via the related project.updatedAt', async () => {
    mockPrisma.marketListing.findMany.mockResolvedValue([]);
    mockPrisma.marketListing.count.mockResolvedValue(0);

    await service.findAll({ limit: 20, sortBy: 'verificationDate', sortOrder: 'asc' } as any);

    expect(mockPrisma.marketListing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ project: { updatedAt: 'asc' } }] }),
    );
  });

  it('sorts by price numerically in memory (ascending), not lexicographically', async () => {
    // Lexicographic sort would put "9" after "10" and "80"; numeric sort must not.
    const rows = [
      listing({ listingId: 'L-80', pricePerCredit: '80' }),
      listing({ listingId: 'L-9', pricePerCredit: '9' }),
      listing({ listingId: 'L-10', pricePerCredit: '10' }),
    ];
    mockPrisma.marketListing.findMany.mockResolvedValue(rows);
    mockPrisma.marketListing.count.mockResolvedValue(rows.length);

    const result = await service.findAll({ limit: 20, sortBy: 'price', sortOrder: 'asc' } as any);

    expect(result.listings.map((l: any) => l.listingId)).toEqual(['L-9', 'L-10', 'L-80']);
  });

  it('sorts by price descending', async () => {
    const rows = [
      listing({ listingId: 'L-9', pricePerCredit: '9' }),
      listing({ listingId: 'L-80', pricePerCredit: '80' }),
      listing({ listingId: 'L-10', pricePerCredit: '10' }),
    ];
    mockPrisma.marketListing.findMany.mockResolvedValue(rows);
    mockPrisma.marketListing.count.mockResolvedValue(rows.length);

    const result = await service.findAll({ limit: 20, sortBy: 'price', sortOrder: 'desc' } as any);

    expect(result.listings.map((l: any) => l.listingId)).toEqual(['L-80', 'L-10', 'L-9']);
  });

  it('paginates price-sorted results by page/limit', async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      listing({ listingId: `L${i}`, pricePerCredit: String(i + 1) }),
    );
    mockPrisma.marketListing.findMany.mockResolvedValue(rows);
    mockPrisma.marketListing.count.mockResolvedValue(rows.length);

    const result = await service.findAll({ limit: 2, page: 2, sortBy: 'price', sortOrder: 'asc' } as any);

    expect(result.listings.map((l: any) => l.listingId)).toEqual(['L2', 'L3']);
    expect(result.total_pages).toBe(3);
  });

  it('returns opaque next and prev cursors for cursor-based pagination', async () => {
    const rows = [
      listing({ listingId: 'L-1', id: 'row-1', createdAt: new Date('2024-01-01T00:00:00.000Z') }),
      listing({ listingId: 'L-2', id: 'row-2', createdAt: new Date('2024-01-02T00:00:00.000Z') }),
      listing({ listingId: 'L-3', id: 'row-3', createdAt: new Date('2024-01-03T00:00:00.000Z') }),
    ];
    mockPrisma.marketListing.findMany.mockResolvedValue(rows);
    mockPrisma.marketListing.count.mockResolvedValue(rows.length);

    const result = await service.findAll({ limit: 2, cursor: undefined } as any);
    expect(result.next_cursor).toBeDefined();
    expect(result.prev_cursor).toBeUndefined();
    expect(result.total_count).toBe(3);
  });
});
