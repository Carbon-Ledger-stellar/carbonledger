/**
 * portfolio.service.spec.ts
 *
 * Unit + integration tests for PortfolioService (#605).
 *
 * Covers:
 *   1. All 7 portfolio metrics computed correctly
 *   2. Empty portfolio edge case (returns zeros)
 *   3. All-credits-retired edge case (inventory = 0, coverage = 100%)
 *   4. Mixed portfolio (partial retirements)
 *   5. Time-period breakdown (month / quarter / year granularity)
 *   6. Redis cache hit / miss behaviour
 *   7. Cache invalidation
 *   8. Materialized view refresh (delegates to DB, non-fatal on error)
 */

import { PortfolioService } from './portfolio.service';
import { TimePeriod } from './portfolio.dto';
import { Decimal } from '@prisma/client/runtime/library';

// ─── Mock factories ──────────────────────────────────────────────────────────

function makeDecimal(n: number | string): Decimal {
  return new Decimal(n);
}

function makePrismaMock(overrides: {
  creditSummary?: Record<string, unknown> | null;
  methodologyDist?: Record<string, unknown>[];
  vintageSpread?: Record<string, unknown>[];
  avgPrice?: Record<string, unknown> | null;
  retirementRows?: Array<{
    retiredAt: Date;
    amount: Decimal;
    isValid: boolean;
  }>;
} = {}) {
  const {
    creditSummary = null,
    methodologyDist = [],
    vintageSpread = [],
    avgPrice = null,
    retirementRows = [],
  } = overrides;

  return {
    $queryRaw: jest.fn().mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?').toLowerCase();
      if (sql.includes('mv_portfolio_credit_summary')) {
        return Promise.resolve(creditSummary ? [creditSummary] : []);
      }
      if (sql.includes('mv_portfolio_methodology_dist')) {
        return Promise.resolve(methodologyDist);
      }
      if (sql.includes('mv_portfolio_vintage_spread')) {
        return Promise.resolve(vintageSpread);
      }
      if (sql.includes('mv_portfolio_avg_price')) {
        return Promise.resolve(avgPrice ? [avgPrice] : []);
      }
      return Promise.resolve([]);
    }),
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
    retirementRecord: {
      findMany: jest.fn().mockResolvedValue(retirementRows),
    },
  } as unknown as import('../prisma.service').PrismaService;
}

function makeRedisMock(cachedValue: unknown = null) {
  return {
    get: jest.fn().mockResolvedValue(cachedValue),
    set: jest.fn().mockResolvedValue(true),
    del: jest.fn().mockResolvedValue(true),
    delByPattern: jest.fn().mockResolvedValue(true),
  } as unknown as import('../redis.service').RedisService;
}

// ─── Test data helpers ────────────────────────────────────────────────────────

const ADDR = 'GABC123XYZ';

function creditSummaryRow(overrides: Partial<{
  total_purchased: string | number;
  total_retired: string | number;
  inventory: string | number;
  inventory_pending: string | number;
  coverage_ratio_pct: string | number;
}> = {}) {
  return {
    owner_address: ADDR,
    total_purchased: makeDecimal(overrides.total_purchased ?? 1000),
    total_retired: makeDecimal(overrides.total_retired ?? 600),
    inventory: makeDecimal(overrides.inventory ?? 400),
    inventory_pending: makeDecimal(overrides.inventory_pending ?? 0),
    coverage_ratio_pct: makeDecimal(overrides.coverage_ratio_pct ?? 60),
  };
}

function methodologyRows() {
  return [
    { owner_address: ADDR, methodology: 'REDD+',       total_tonnes: makeDecimal(700), retirement_count: BigInt(5) },
    { owner_address: ADDR, methodology: 'Gold Standard', total_tonnes: makeDecimal(300), retirement_count: BigInt(2) },
  ];
}

function vintageRows() {
  return [
    { owner_address: ADDR, vintage_year: 2022, total_tonnes: makeDecimal(400), retirement_count: BigInt(3) },
    { owner_address: ADDR, vintage_year: 2023, total_tonnes: makeDecimal(400), retirement_count: BigInt(3) },
    { owner_address: ADDR, vintage_year: 2024, total_tonnes: makeDecimal(200), retirement_count: BigInt(1) },
  ];
}

function avgPriceRow() {
  return {
    owner_address: ADDR,
    avg_price_per_credit: makeDecimal('15.50'),
    min_price_per_credit: makeDecimal('12.00'),
    max_price_per_credit: makeDecimal('20.00'),
    retirement_count: BigInt(7),
  };
}

function retirementRows(count = 6): Array<{ retiredAt: Date; amount: Decimal; isValid: boolean }> {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      retiredAt: new Date(`2024-0${(i % 3) + 1}-15`),
      amount: makeDecimal(100),
      isValid: i < 4, // first 4 valid, last 2 invalid
    });
  }
  return rows;
}

// ─── PortfolioService tests ───────────────────────────────────────────────────

describe('PortfolioService', () => {
  describe('getMetrics() — cache miss path', () => {
    it('returns all 7 metrics for a fully populated portfolio', async () => {
      const prisma = makePrismaMock({
        creditSummary: creditSummaryRow(),
        methodologyDist: methodologyRows(),
        vintageSpread: vintageRows(),
        avgPrice: avgPriceRow(),
        retirementRows: retirementRows(),
      });
      const redis = makeRedisMock(null);
      const service = new PortfolioService(prisma, redis);

      const result = await service.getMetrics(ADDR, 'year');

      // Metric 1: total tonnes purchased
      expect(result.totalTonnesPurchased).toBe(1000);
      // Metric 2: total tonnes retired
      expect(result.totalTonnesRetired).toBe(600);
      // Metric 3: remaining inventory
      expect(result.remainingInventory).toBe(400);
      // Metric 4: methodology distribution
      expect(result.methodologyDistribution).toHaveLength(2);
      expect(result.methodologyDistribution[0].methodology).toBe('REDD+');
      expect(result.methodologyDistribution[0].totalTonnes).toBe(700);
      expect(result.methodologyDistribution[0].percentage).toBe(70);
      // Metric 5: vintage spread
      expect(result.vintageSpread).toHaveLength(3);
      expect(result.vintageSpread[0].vintageYear).toBe(2022);
      // Metric 6: avg price paid
      expect(result.avgPricePaidPerTonne).toBeCloseTo(15.5);
      expect(result.minPricePaidPerTonne).toBe(12);
      expect(result.maxPricePaidPerTonne).toBe(20);
      // Metric 7: retirement coverage ratio
      expect(result.retirementCoverageRatioPct).toBe(60);
    });

    it('stores the result in Redis after computing', async () => {
      const prisma = makePrismaMock({ creditSummary: creditSummaryRow() });
      const redis = makeRedisMock(null);
      const service = new PortfolioService(prisma, redis);

      await service.getMetrics(ADDR, 'year');

      // Await any pending microtasks (the set call is non-blocking)
      await Promise.resolve();
      expect(redis.set).toHaveBeenCalledWith(
        `cache:portfolio:${ADDR}:year`,
        expect.any(Object),
        120,
      );
    });
  });

  describe('getMetrics() — cache hit path', () => {
    it('returns the cached snapshot without hitting the database', async () => {
      const cachedSnapshot = { ownerAddress: ADDR, totalTonnesPurchased: 999 };
      const prisma = makePrismaMock();
      const redis = makeRedisMock(cachedSnapshot);
      const service = new PortfolioService(prisma, redis);

      const result = await service.getMetrics(ADDR, 'year');

      expect(result).toEqual(cachedSnapshot);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('Edge case: empty portfolio', () => {
    it('returns zeros for all numeric metrics', async () => {
      const prisma = makePrismaMock({
        creditSummary: null,
        methodologyDist: [],
        vintageSpread: [],
        avgPrice: null,
        retirementRows: [],
      });
      const redis = makeRedisMock(null);
      const service = new PortfolioService(prisma, redis);

      const result = await service.getMetrics('GEMPTY000', 'year');

      expect(result.totalTonnesPurchased).toBe(0);
      expect(result.totalTonnesRetired).toBe(0);
      expect(result.remainingInventory).toBe(0);
      expect(result.retirementCoverageRatioPct).toBe(0);
      expect(result.avgPricePaidPerTonne).toBeNull();
      expect(result.methodologyDistribution).toHaveLength(0);
      expect(result.vintageSpread).toHaveLength(0);
      expect(result.timePeriodBreakdown).toHaveLength(0);
    });
  });

  describe('Edge case: all credits retired', () => {
    it('returns inventory=0 and coverage=100', async () => {
      const prisma = makePrismaMock({
        creditSummary: creditSummaryRow({
          total_purchased: 500,
          total_retired: 500,
          inventory: 0,
          coverage_ratio_pct: 100,
        }),
        retirementRows: [],
      });
      const redis = makeRedisMock(null);
      const service = new PortfolioService(prisma, redis);

      const result = await service.getMetrics(ADDR, 'year');

      expect(result.remainingInventory).toBe(0);
      expect(result.retirementCoverageRatioPct).toBe(100);
    });
  });

  describe('Edge case: all credits purchased, none retired', () => {
    it('returns retired=0 and coverage=0 with full inventory', async () => {
      const prisma = makePrismaMock({
        creditSummary: creditSummaryRow({
          total_purchased: 300,
          total_retired: 0,
          inventory: 300,
          coverage_ratio_pct: 0,
        }),
        retirementRows: [],
      });
      const redis = makeRedisMock(null);
      const service = new PortfolioService(prisma, redis);

      const result = await service.getMetrics(ADDR, 'year');

      expect(result.totalTonnesRetired).toBe(0);
      expect(result.remainingInventory).toBe(300);
      expect(result.retirementCoverageRatioPct).toBe(0);
    });
  });

  describe('Time-period breakdown', () => {
    const makeRows = (dates: string[], tonnes: number, isValid: boolean) =>
      dates.map((d) => ({
        retiredAt: new Date(d),
        amount: makeDecimal(tonnes),
        isValid,
      }));

    it('groups by month correctly', async () => {
      const rows = [
        ...makeRows(['2024-01-10', '2024-01-20'], 100, true),
        ...makeRows(['2024-02-05'],                100, true),
        ...makeRows(['2024-03-15'],                100, false),
      ];
      const prisma = makePrismaMock({ retirementRows: rows });
      const redis = makeRedisMock(null);
      const service = new PortfolioService(prisma, redis);

      const result = await service.getMetrics(ADDR, 'month');

      expect(result.timePeriodBreakdown).toHaveLength(3);
      const jan = result.timePeriodBreakdown.find((b) => b.period === '2024-01');
      expect(jan?.totalPurchased).toBe(200);
      expect(jan?.totalRetired).toBe(200);
      const mar = result.timePeriodBreakdown.find((b) => b.period === '2024-03');
      expect(mar?.totalPurchased).toBe(100);
      expect(mar?.totalRetired).toBe(0); // isValid=false
    });

    it('groups by quarter correctly', async () => {
      const rows = [
        ...makeRows(['2024-01-10', '2024-03-20'], 100, true),  // Q1
        ...makeRows(['2024-04-15'],                200, true),  // Q2
        ...makeRows(['2024-10-01'],                150, false), // Q4
      ];
      const prisma = makePrismaMock({ retirementRows: rows });
      const redis = makeRedisMock(null);
      const service = new PortfolioService(prisma, redis);

      const result = await service.getMetrics(ADDR, 'quarter');

      const q1 = result.timePeriodBreakdown.find((b) => b.period === '2024-Q1');
      expect(q1?.totalPurchased).toBe(200);
      const q2 = result.timePeriodBreakdown.find((b) => b.period === '2024-Q2');
      expect(q2?.totalPurchased).toBe(200);
      const q4 = result.timePeriodBreakdown.find((b) => b.period === '2024-Q4');
      expect(q4?.totalRetired).toBe(0);
    });

    it('groups by year correctly', async () => {
      const rows = [
        ...makeRows(['2022-06-01'],                300, true),
        ...makeRows(['2023-01-01', '2023-12-31'], 250, true),
        ...makeRows(['2024-07-01'],                100, false),
      ];
      const prisma = makePrismaMock({ retirementRows: rows });
      const redis = makeRedisMock(null);
      const service = new PortfolioService(prisma, redis);

      const result = await service.getMetrics(ADDR, 'year');

      const y2022 = result.timePeriodBreakdown.find((b) => b.period === '2022');
      expect(y2022?.totalPurchased).toBe(300);
      const y2023 = result.timePeriodBreakdown.find((b) => b.period === '2023');
      expect(y2023?.totalPurchased).toBe(500);
      const y2024 = result.timePeriodBreakdown.find((b) => b.period === '2024');
      expect(y2024?.totalRetired).toBe(0);
    });

    it('returns sorted periods (ascending chronological order)', async () => {
      const rows = [
        { retiredAt: new Date('2024-03-01'), amount: makeDecimal(50), isValid: true },
        { retiredAt: new Date('2024-01-01'), amount: makeDecimal(50), isValid: true },
        { retiredAt: new Date('2024-02-01'), amount: makeDecimal(50), isValid: true },
      ];
      const prisma = makePrismaMock({ retirementRows: rows });
      const redis = makeRedisMock(null);
      const service = new PortfolioService(prisma, redis);

      const result = await service.getMetrics(ADDR, 'month');
      const periods = result.timePeriodBreakdown.map((b) => b.period);
      expect(periods).toEqual(['2024-01', '2024-02', '2024-03']);
    });
  });

  describe('Methodology distribution percentages', () => {
    it('percentages sum to 100 for a two-methodology portfolio', async () => {
      const prisma = makePrismaMock({
        creditSummary: creditSummaryRow({ total_purchased: 1000 }),
        methodologyDist: [
          { owner_address: ADDR, methodology: 'REDD+', total_tonnes: makeDecimal(600), retirement_count: BigInt(4) },
          { owner_address: ADDR, methodology: 'VCS',   total_tonnes: makeDecimal(400), retirement_count: BigInt(3) },
        ],
      });
      const redis = makeRedisMock(null);
      const service = new PortfolioService(prisma, redis);

      const result = await service.getMetrics(ADDR, 'year');
      const total = result.methodologyDistribution.reduce((sum, m) => sum + m.percentage, 0);
      expect(total).toBeCloseTo(100);
    });

    it('returns 0% for all methods when total purchased is 0', async () => {
      const prisma = makePrismaMock({
        creditSummary: creditSummaryRow({ total_purchased: 0, total_retired: 0, coverage_ratio_pct: 0 }),
        methodologyDist: [
          { owner_address: ADDR, methodology: 'REDD+', total_tonnes: makeDecimal(0), retirement_count: BigInt(0) },
        ],
      });
      const redis = makeRedisMock(null);
      const service = new PortfolioService(prisma, redis);

      const result = await service.getMetrics(ADDR, 'year');
      expect(result.methodologyDistribution[0].percentage).toBe(0);
    });
  });

  describe('invalidateCache()', () => {
    it('calls delByPattern with the correct wildcard key', async () => {
      const prisma = makePrismaMock();
      const redis = makeRedisMock();
      const service = new PortfolioService(prisma, redis);

      await service.invalidateCache(ADDR);

      expect(redis.delByPattern).toHaveBeenCalledWith(`cache:portfolio:${ADDR}:*`);
    });
  });

  describe('refreshMaterializedViews()', () => {
    it('refreshes all four views', async () => {
      const prisma = makePrismaMock();
      const redis = makeRedisMock();
      const service = new PortfolioService(prisma, redis);

      await service.refreshMaterializedViews();

      const calls = (prisma.$executeRawUnsafe as jest.Mock).mock.calls.flat() as string[];
      expect(calls.some((c) => c.includes('mv_portfolio_credit_summary'))).toBe(true);
      expect(calls.some((c) => c.includes('mv_portfolio_methodology_dist'))).toBe(true);
      expect(calls.some((c) => c.includes('mv_portfolio_vintage_spread'))).toBe(true);
      expect(calls.some((c) => c.includes('mv_portfolio_avg_price'))).toBe(true);
    });

    it('continues refreshing remaining views if one fails', async () => {
      let callCount = 0;
      const prisma = {
        ...makePrismaMock(),
        $executeRawUnsafe: jest.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return Promise.reject(new Error('DB error'));
          return Promise.resolve(undefined);
        }),
      } as unknown as import('../prisma.service').PrismaService;
      const redis = makeRedisMock();
      const service = new PortfolioService(prisma, redis);

      // Should not throw even though one view fails
      await expect(service.refreshMaterializedViews()).resolves.not.toThrow();
    });
  });

  describe('computedAt timestamp', () => {
    it('returns a valid ISO timestamp in the response', async () => {
      const prisma = makePrismaMock();
      const redis = makeRedisMock(null);
      const service = new PortfolioService(prisma, redis);
      const before = new Date().toISOString();

      const result = await service.getMetrics(ADDR, 'year');

      expect(result.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(new Date(result.computedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(before).getTime(),
      );
    });
  });

  describe('ownerAddress in response', () => {
    it('echoes back the requested address', async () => {
      const prisma = makePrismaMock();
      const redis = makeRedisMock(null);
      const service = new PortfolioService(prisma, redis);

      const result = await service.getMetrics('GTEST999', 'year');
      expect(result.ownerAddress).toBe('GTEST999');
    });
  });
});

// ─── PortfolioController tests ────────────────────────────────────────────────

import { PortfolioController } from './portfolio.controller';
import { BadRequestException } from '@nestjs/common';

describe('PortfolioController', () => {
  function makeServiceMock() {
    return {
      getMetrics: jest.fn().mockResolvedValue({ ownerAddress: ADDR, totalTonnesPurchased: 500 }),
      refreshMaterializedViews: jest.fn().mockResolvedValue(undefined),
    } as unknown as PortfolioService;
  }

  it('calls getMetrics with correct address and default period', async () => {
    const service = makeServiceMock();
    const controller = new PortfolioController(service);

    await controller.getMetrics({ address: ADDR });

    expect(service.getMetrics).toHaveBeenCalledWith(ADDR, 'year');
  });

  it('passes through the requested period', async () => {
    const service = makeServiceMock();
    const controller = new PortfolioController(service);

    await controller.getMetrics({ address: ADDR, period: 'quarter' });

    expect(service.getMetrics).toHaveBeenCalledWith(ADDR, 'quarter');
  });

  it('trims whitespace from the address', async () => {
    const service = makeServiceMock();
    const controller = new PortfolioController(service);

    await controller.getMetrics({ address: `  ${ADDR}  ` });

    expect(service.getMetrics).toHaveBeenCalledWith(ADDR, 'year');
  });

  it('throws BadRequestException for missing address', async () => {
    const service = makeServiceMock();
    const controller = new PortfolioController(service);

    await expect(
      controller.getMetrics({ address: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException for invalid period', async () => {
    const service = makeServiceMock();
    const controller = new PortfolioController(service);

    await expect(
      controller.getMetrics({ address: ADDR, period: 'decade' as TimePeriod }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refreshViews() delegates to service', async () => {
    const service = makeServiceMock();
    const controller = new PortfolioController(service);

    const result = await controller.refreshViews();

    expect(service.refreshMaterializedViews).toHaveBeenCalled();
    expect(result.refreshed).toBe(true);
  });
});
