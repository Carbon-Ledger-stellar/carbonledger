/**
 * Integration tests for MarketplaceSearchService
 *
 * Tests are written against a mock PrismaService so no real database is
 * required. The mock intercepts $queryRawUnsafe calls and returns
 * deterministic fixtures, letting us verify:
 *
 *   1. Text search (full-text via tsvector / plainto_tsquery)
 *   2. Combined faceted filters (methodology + vintage + country + price + status + seller)
 *   3. Empty results (zero rows returned, has_more = false)
 *   4. Invalid filter values (missing filters → 400, bad price → 400)
 *   5. Cursor pagination (next_cursor set when has_more = true)
 *   6. Sort options (relevance, price_asc, price_desc, vintage_asc, vintage_desc, createdAt)
 *
 * Each test inspects the SQL string and args passed to $queryRawUnsafe to
 * confirm the correct clauses were generated, in addition to checking the
 * shaped response envelope.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { MarketplaceSearchService } from './marketplace-search.service';
import { PrismaService } from '../prisma.service';
import { SearchListingsDto } from './marketplace.dto';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_ROW = {
  id:              'listing-id-1',
  listingId:       'lst-1',
  projectId:       'proj-1',
  batchId:         'batch-1',
  seller:          'GSELLER1',
  amountAvailable: '500.00',
  pricePerCredit:  '12.50',
  vintageYear:     2022,
  methodology:     'VCS',
  country:         'Brazil',
  status:          'Active',
  createdAt:       new Date('2024-01-01T00:00:00Z'),
  updatedAt:       new Date('2024-01-01T00:00:00Z'),
  rank:            0.6543,
  projectName:     'Amazon Rainforest REDD+',
  projectStatus:   'Verified',
  methodologyScore: 85,
};

function makeRow(overrides: Partial<typeof BASE_ROW> = {}) {
  return { ...BASE_ROW, ...overrides };
}

function makeCountRow(count: number): [{ count: bigint }] {
  return [{ count: BigInt(count) }];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Builds a mock PrismaService whose $queryRawUnsafe returns `rows` for data
 *  queries and `countRows` for count queries. */
function mockPrisma(dataRows: any[], count: number) {
  let callCount = 0;
  return {
    $queryRawUnsafe: jest.fn().mockImplementation(async (...args: any[]) => {
      // First call is the data query, second is the count query
      // (they're issued in parallel via Promise.all, so Jest resolves them in
      // the order they were registered)
      callCount++;
      if (callCount % 2 === 1) return dataRows;          // odd calls = data
      return makeCountRow(count);                        // even calls = count
    }),
  } as unknown as PrismaService;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('MarketplaceSearchService', () => {
  let service: MarketplaceSearchService;
  let prisma: jest.Mocked<PrismaService>;

  async function buildService(dataRows: any[] = [], count = 0) {
    const mockPrismaInstance = {
      $queryRawUnsafe: jest.fn(),
    } as unknown as jest.Mocked<PrismaService>;

    // By default, first call returns data rows, second call returns count.
    // Tests can override per-scenario by reassigning the mock.
    let callCount = 0;
    (mockPrismaInstance.$queryRawUnsafe as jest.Mock).mockImplementation(
      async (..._args: any[]) => {
        callCount++;
        if (callCount % 2 === 1) return dataRows;
        return makeCountRow(count);
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketplaceSearchService,
        { provide: PrismaService, useValue: mockPrismaInstance },
      ],
    }).compile();

    service = module.get<MarketplaceSearchService>(MarketplaceSearchService);
    prisma  = module.get<jest.Mocked<PrismaService>>(PrismaService as any);
    return { service, prisma };
  }

  // ── 1. Text search ─────────────────────────────────────────────────────────

  describe('text search', () => {
    it('includes plainto_tsquery condition when search is provided', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      const dto: SearchListingsDto = { search: 'rainforest' };

      await service.searchListings(dto);

      const [selectSQL, ...args] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(selectSQL).toContain('plainto_tsquery');
      expect(selectSQL).toContain('@@ plainto_tsquery');
      expect(args[0]).toBe('rainforest');
    });

    it('includes ts_rank in SELECT when search is provided', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      await service.searchListings({ search: 'biomass' });

      const [selectSQL] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(selectSQL).toContain('ts_rank');
    });

    it('orders by ts_rank DESC when sortBy=relevance', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      await service.searchListings({ search: 'wind energy', sortBy: 'relevance' });

      const [selectSQL] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(selectSQL).toContain('ts_rank');
      expect(selectSQL).toContain('DESC');
    });

    it('returns rank value in result items', async () => {
      const { service } = await buildService([makeRow({ rank: 0.6543 })], 1);
      const result = await service.searchListings({ search: 'REDD' });

      expect(result.results[0].rank).toBeCloseTo(0.6543, 3);
    });

    it('returns projectName from joined CarbonProject', async () => {
      const { service } = await buildService(
        [makeRow({ projectName: 'Amazon Rainforest REDD+' })],
        1,
      );
      const result = await service.searchListings({ search: 'amazon' });

      expect(result.results[0].projectName).toBe('Amazon Rainforest REDD+');
    });

    it('searches both listing searchVector and project searchVector', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      await service.searchListings({ search: 'solar' });

      const [selectSQL] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      // Should check both ml."searchVector" and cp."searchVector"
      expect(selectSQL).toContain('ml."searchVector"');
      expect(selectSQL).toContain('cp."searchVector"');
    });
  });

  // ── 2. Combined faceted filters ────────────────────────────────────────────

  describe('combined faceted filters', () => {
    it('applies methodology facet as ANY($n::text[])', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      await service.searchListings({ methodology: ['VCS', 'Gold Standard'] });

      const calls = (prisma.$queryRawUnsafe as jest.Mock).mock.calls;
      const [selectSQL, ...args] = calls[0];
      expect(selectSQL).toContain('= ANY(');
      expect(selectSQL).toContain('::text[]');
      expect(args).toContain(jasmine?.arrayContaining?.(['VCS', 'Gold Standard']) ?? expect.arrayContaining(['VCS', 'Gold Standard']));
    });

    it('applies vintage facet as ANY($n::int[])', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      await service.searchListings({ vintage: [2021, 2022] });

      const [selectSQL] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(selectSQL).toContain('"vintageYear" = ANY(');
      expect(selectSQL).toContain('::int[]');
    });

    it('applies country facet', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      await service.searchListings({ country: ['Brazil', 'Kenya'] });

      const [selectSQL] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(selectSQL).toContain('"country" = ANY(');
    });

    it('applies minPrice facet using CAST AS NUMERIC >=', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      await service.searchListings({ minPrice: '10.00' });

      const [selectSQL, ...args] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(selectSQL).toContain('CAST(ml."pricePerCredit" AS NUMERIC)');
      expect(selectSQL).toContain('>=');
      expect(args).toContain('10.00');
    });

    it('applies maxPrice facet using CAST AS NUMERIC <=', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      await service.searchListings({ maxPrice: '50.00' });

      const [selectSQL, ...args] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(selectSQL).toContain('CAST(ml."pricePerCredit" AS NUMERIC)');
      expect(selectSQL).toContain('<=');
      expect(args).toContain('50.00');
    });

    it('applies status facet as ANY($n::text[])', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      await service.searchListings({ status: ['Active', 'PartiallyFilled'] });

      const [selectSQL] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(selectSQL).toContain('"status" = ANY(');
    });

    it('applies seller facet as exact match', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      await service.searchListings({ seller: 'GSELLER1' });

      const [selectSQL, ...args] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(selectSQL).toContain('ml."seller" =');
      expect(args).toContain('GSELLER1');
    });

    it('applies all 6 facets simultaneously', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      await service.searchListings({
        search:      'forest',
        methodology: ['VCS'],
        vintage:     [2022],
        country:     ['Brazil'],
        minPrice:    '10',
        maxPrice:    '50',
        status:      ['Active'],
        seller:      'GSELLER1',
      });

      const [selectSQL] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      // All 6 facets + full-text must appear in the WHERE clause
      expect(selectSQL).toContain('plainto_tsquery');
      expect(selectSQL).toContain('"methodology"');
      expect(selectSQL).toContain('"vintageYear"');
      expect(selectSQL).toContain('"country"');
      expect(selectSQL).toContain('"pricePerCredit"');
      expect(selectSQL).toContain('"status"');
      expect(selectSQL).toContain('"seller"');
    });

    it('issues data and count queries in parallel (two $queryRawUnsafe calls)', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      await service.searchListings({ methodology: ['VCS'] });

      // Promise.all triggers both at ~the same time; we verify both are called
      expect((prisma.$queryRawUnsafe as jest.Mock).mock.calls.length).toBe(2);
    });

    it('count query uses same WHERE as data query', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      await service.searchListings({ methodology: ['VCS'], country: ['Brazil'] });

      const calls = (prisma.$queryRawUnsafe as jest.Mock).mock.calls;
      const [selectSQL] = calls[0];
      const [countSQL]  = calls[1];

      // Both queries share the same parameter bindings pattern
      expect(countSQL).toContain('COUNT(*)');
      // Both must reference the same facet conditions
      expect(countSQL).toContain('"methodology"');
      expect(countSQL).toContain('"country"');
      // The data query params and count query params should be identical
      expect(calls[0].slice(1)).toEqual(calls[1].slice(1));
    });
  });

  // ── 3. Empty results ───────────────────────────────────────────────────────

  describe('empty results', () => {
    it('returns empty results array with total_count=0 when no rows match', async () => {
      const { service } = await buildService([], 0);
      const result = await service.searchListings({ search: 'xyznothing' });

      expect(result.results).toHaveLength(0);
      expect(result.total_count).toBe(0);
      expect(result.has_more).toBe(false);
      expect(result.next_cursor).toBeUndefined();
    });

    it('has_more is false when fewer rows than limit', async () => {
      const { service } = await buildService([makeRow()], 1);
      const result = await service.searchListings({ search: 'forest', limit: 20 });

      expect(result.has_more).toBe(false);
    });

    it('rank is null in all results when no search term', async () => {
      const rowWithNullRank = makeRow({ rank: null as any });
      const { service } = await buildService([rowWithNullRank], 1);
      const result = await service.searchListings({ methodology: ['VCS'] });

      expect(result.results[0].rank).toBeNull();
    });
  });

  // ── 4. Invalid filter values ───────────────────────────────────────────────

  describe('invalid filter values', () => {
    it('throws 400 when no filter is provided', async () => {
      const { service } = await buildService([], 0);
      await expect(service.searchListings({})).rejects.toThrow(BadRequestException);
    });

    it('throws 400 with message when no filter is provided', async () => {
      const { service } = await buildService([], 0);
      await expect(service.searchListings({})).rejects.toThrow(
        'At least one search or filter parameter is required',
      );
    });

    it('throws 400 for non-numeric minPrice', async () => {
      const { service } = await buildService([], 0);
      await expect(
        service.searchListings({ minPrice: 'not-a-number' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 400 for non-numeric maxPrice', async () => {
      const { service } = await buildService([], 0);
      await expect(
        service.searchListings({ maxPrice: 'abc' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 400 when minPrice > maxPrice', async () => {
      const { service } = await buildService([], 0);
      await expect(
        service.searchListings({ minPrice: '100', maxPrice: '10' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 400 for minPrice > maxPrice with descriptive message', async () => {
      const { service } = await buildService([], 0);
      await expect(
        service.searchListings({ minPrice: '999', maxPrice: '1' }),
      ).rejects.toThrow('minPrice must be less than or equal to maxPrice');
    });

    it('does NOT throw for equal minPrice and maxPrice (exact price match)', async () => {
      const { service } = await buildService([makeRow()], 1);
      await expect(
        service.searchListings({ minPrice: '10', maxPrice: '10' }),
      ).resolves.toBeDefined();
    });
  });

  // ── 5. Cursor pagination ───────────────────────────────────────────────────

  describe('cursor-based pagination', () => {
    it('sets next_cursor to id of last item when has_more=true', async () => {
      // With limit=2, return 3 rows (limit+1 sentinel)
      const rows = [
        makeRow({ id: 'id-1' }),
        makeRow({ id: 'id-2' }),
        makeRow({ id: 'id-3' }), // sentinel row (limit+1)
      ];
      const { service } = await buildService(rows, 3);
      const result = await service.searchListings({ search: 'forest', limit: 2 });

      expect(result.has_more).toBe(true);
      expect(result.next_cursor).toBe('id-2'); // last item before sentinel
      expect(result.results).toHaveLength(2);  // sentinel is removed
    });

    it('does not set next_cursor when fewer rows than limit', async () => {
      const { service } = await buildService([makeRow({ id: 'id-1' })], 1);
      const result = await service.searchListings({ search: 'solar', limit: 20 });

      expect(result.has_more).toBe(false);
      expect(result.next_cursor).toBeUndefined();
    });

    it('includes cursor in WHERE clause when cursor is provided', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      await service.searchListings({ search: 'forest', cursor: 'some-cursor-id' });

      const [selectSQL, ...args] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(selectSQL).toContain('ml."id" >');
      expect(args).toContain('some-cursor-id');
    });
  });

  // ── 6. Sort options ────────────────────────────────────────────────────────

  describe('sort options', () => {
    it('sorts by price ASC when sortBy=price_asc', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      await service.searchListings({ methodology: ['VCS'], sortBy: 'price_asc' });

      const [selectSQL] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(selectSQL).toContain('CAST(ml."pricePerCredit" AS NUMERIC) ASC');
    });

    it('sorts by price DESC when sortBy=price_desc', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      await service.searchListings({ methodology: ['VCS'], sortBy: 'price_desc' });

      const [selectSQL] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(selectSQL).toContain('CAST(ml."pricePerCredit" AS NUMERIC) DESC');
    });

    it('sorts by vintageYear ASC when sortBy=vintage_asc', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      await service.searchListings({ country: ['Brazil'], sortBy: 'vintage_asc' });

      const [selectSQL] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(selectSQL).toContain('"vintageYear" ASC');
    });

    it('sorts by vintageYear DESC when sortBy=vintage_desc', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      await service.searchListings({ country: ['Brazil'], sortBy: 'vintage_desc' });

      const [selectSQL] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(selectSQL).toContain('"vintageYear" DESC');
    });

    it('sorts by createdAt DESC when sortBy=createdAt', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      await service.searchListings({ country: ['Brazil'], sortBy: 'createdAt' });

      const [selectSQL] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(selectSQL).toContain('"createdAt" DESC');
    });

    it('defaults to relevance sort when search is present and no sortBy given', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      await service.searchListings({ search: 'solar' });

      const [selectSQL] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(selectSQL).toContain('ts_rank');
    });

    it('defaults to createdAt sort when no search and no sortBy given', async () => {
      const { service, prisma } = await buildService([makeRow()], 1);
      await service.searchListings({ methodology: ['VCS'] });

      const [selectSQL] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0];
      expect(selectSQL).toContain('"createdAt" DESC');
    });
  });

  // ── 7. Response shape ──────────────────────────────────────────────────────

  describe('response envelope shape', () => {
    it('returns correctly shaped SearchListingsResponse', async () => {
      const { service } = await buildService([makeRow()], 1);
      const result = await service.searchListings({ search: 'forest' });

      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('total_count');
      expect(result).toHaveProperty('has_more');
      expect(Array.isArray(result.results)).toBe(true);
    });

    it('maps amountAvailable as string (Decimal serialisation)', async () => {
      const { service } = await buildService([makeRow({ amountAvailable: '500.00' })], 1);
      const result = await service.searchListings({ search: 'solar' });

      expect(typeof result.results[0].amountAvailable).toBe('string');
    });

    it('maps methodologyScore as number or null', async () => {
      const { service } = await buildService([makeRow({ methodologyScore: 85 })], 1);
      const result = await service.searchListings({ search: 'solar' });

      expect(typeof result.results[0].methodologyScore).toBe('number');
    });

    it('total_count comes from count query, not row length', async () => {
      const { service } = await buildService([makeRow(), makeRow({ id: 'id-2' })], 100);
      const result = await service.searchListings({ search: 'forest' });

      expect(result.total_count).toBe(100);
    });

    it('joins CarbonProject LEFT JOIN so missing project gives null fields', async () => {
      const rowWithNullProject = makeRow({
        projectName:     null as any,
        projectStatus:   null as any,
        methodologyScore: null as any,
      });
      const { service } = await buildService([rowWithNullProject], 1);
      const result = await service.searchListings({ search: 'solar' });

      expect(result.results[0].projectName).toBeNull();
      expect(result.results[0].projectStatus).toBeNull();
      expect(result.results[0].methodologyScore).toBeNull();
    });
  });
});
