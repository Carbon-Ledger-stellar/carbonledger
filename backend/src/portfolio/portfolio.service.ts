import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis.service';
import {
  TimePeriod,
  PortfolioMetricsResponse,
  MethodologyBreakdown,
  VintageBreakdown,
  TimePeriodBreakdown,
} from './portfolio.dto';
import { Decimal } from '@prisma/client/runtime/library';

/** Redis TTL for portfolio snapshots (seconds) */
const CACHE_TTL_SECONDS = 120;

/** Cache key factory — uses `cache:` prefix (allowed by RedisService) */
const cacheKey = (address: string, period: TimePeriod) =>
  `cache:portfolio:${address}:${period}`;

/** Cache-bust pattern for a single address */
const cacheKeyPattern = (address: string) => `cache:portfolio:${address}:*`;

/**
 * Format a Date into the period label used in TimePeriodBreakdown.
 *   month   → "2025-03"
 *   quarter → "2025-Q2"
 *   year    → "2025"
 */
function formatPeriodLabel(date: Date, period: TimePeriod): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1; // 1-based
  switch (period) {
    case 'month':
      return `${y}-${String(m).padStart(2, '0')}`;
    case 'quarter':
      return `${y}-Q${Math.ceil(m / 3)}`;
    case 'year':
    default:
      return `${y}`;
  }
}

function toNumber(value: Decimal | number | string | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseFloat(value) || 0;
  return value.toNumber();
}

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Returns all 7 portfolio metrics for a given buyer address.
   * Results are cached in Redis for CACHE_TTL_SECONDS (120 s).
   *
   * @param address  Stellar wallet address of the corporate buyer.
   * @param period   Time-period granularity for the breakdown (month/quarter/year).
   */
  async getMetrics(
    address: string,
    period: TimePeriod = 'year',
  ): Promise<PortfolioMetricsResponse> {
    const key = cacheKey(address, period);

    // ── Cache hit ──────────────────────────────────────────────────────────────
    const cached = await this.redis.get<PortfolioMetricsResponse>(key);
    if (cached) {
      this.logger.debug(`Portfolio cache HIT for ${address} (${period})`);
      return cached;
    }

    // ── Compute ────────────────────────────────────────────────────────────────
    this.logger.debug(`Portfolio cache MISS for ${address} (${period}) – computing`);
    const result = await this.computeMetrics(address, period);

    // ── Cache write (non-blocking) ────────────────────────────────────────────
    this.redis
      .set(key, result, CACHE_TTL_SECONDS)
      .catch(() => undefined);

    return result;
  }

  /**
   * Invalidate all cached portfolio snapshots for a given address.
   * Call this after any credit retirement or purchase that changes the portfolio.
   */
  async invalidateCache(address: string): Promise<void> {
    await this.redis.delByPattern(cacheKeyPattern(address));
  }

  /**
   * Refresh the four portfolio materialized views.
   * Runs CONCURRENTLY to avoid locking reads.  Called by a scheduled task and
   * after bulk credit state changes.
   */
  async refreshMaterializedViews(): Promise<void> {
    const views = [
      'mv_portfolio_credit_summary',
      'mv_portfolio_methodology_dist',
      'mv_portfolio_vintage_spread',
      'mv_portfolio_avg_price',
    ];
    for (const view of views) {
      try {
        await this.prisma
          .$executeRawUnsafe(
            `REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`,
          )
          .catch(() =>
            // Fall back to non-concurrent refresh when the view has no unique index yet
            // (happens on first population before the index is built).
            this.prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW ${view}`),
          );
        this.logger.debug(`Refreshed ${view}`);
      } catch (err) {
        this.logger.warn(`Failed to refresh ${view}: ${(err as Error).message}`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Core computation (reads from materialized views + live tables)
  // ─────────────────────────────────────────────────────────────────────────────

  private async computeMetrics(
    address: string,
    period: TimePeriod,
  ): Promise<PortfolioMetricsResponse> {
    // All four queries run in parallel for maximum throughput
    const [summary, methodology, vintage, avgPrice, timePeriods] =
      await Promise.all([
        this.queryCreditSummary(address),
        this.queryMethodologyDist(address),
        this.queryVintageSpread(address),
        this.queryAvgPrice(address),
        this.queryTimePeriodBreakdown(address, period),
      ]);

    const totalPurchased = toNumber(summary?.total_purchased);
    const totalRetired = toNumber(summary?.total_retired);
    const inventory = toNumber(summary?.inventory);
    const coverageRatioPct = toNumber(summary?.coverage_ratio_pct);

    // Compute distribution percentages
    const methodologyDist: MethodologyBreakdown[] = methodology.map((row) => ({
      methodology: row.methodology,
      totalTonnes: toNumber(row.total_tonnes),
      retirementCount: Number(row.retirement_count),
      percentage:
        totalPurchased > 0
          ? Math.round((toNumber(row.total_tonnes) / totalPurchased) * 10000) / 100
          : 0,
    }));

    const vintageDist: VintageBreakdown[] = vintage.map((row) => ({
      vintageYear: Number(row.vintage_year),
      totalTonnes: toNumber(row.total_tonnes),
      retirementCount: Number(row.retirement_count),
      percentage:
        totalPurchased > 0
          ? Math.round((toNumber(row.total_tonnes) / totalPurchased) * 10000) / 100
          : 0,
    }));

    return {
      ownerAddress: address,
      totalTonnesPurchased: totalPurchased,
      totalTonnesRetired: totalRetired,
      remainingInventory: inventory,
      retirementCoverageRatioPct: coverageRatioPct,
      avgPricePaidPerTonne: avgPrice?.avg_price_per_credit
        ? toNumber(avgPrice.avg_price_per_credit)
        : null,
      minPricePaidPerTonne: avgPrice?.min_price_per_credit
        ? toNumber(avgPrice.min_price_per_credit)
        : null,
      maxPricePaidPerTonne: avgPrice?.max_price_per_credit
        ? toNumber(avgPrice.max_price_per_credit)
        : null,
      methodologyDistribution: methodologyDist,
      vintageSpread: vintageDist,
      timePeriodBreakdown: timePeriods,
      computedAt: new Date().toISOString(),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Materialized view readers
  // ─────────────────────────────────────────────────────────────────────────────

  private async queryCreditSummary(address: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        owner_address: string;
        total_purchased: Decimal;
        total_retired: Decimal;
        inventory_pending: Decimal;
        inventory: Decimal;
        coverage_ratio_pct: Decimal;
      }>
    >`
      SELECT owner_address,
             total_purchased,
             total_retired,
             inventory_pending,
             inventory,
             coverage_ratio_pct
      FROM mv_portfolio_credit_summary
      WHERE owner_address = ${address}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private async queryMethodologyDist(address: string) {
    return this.prisma.$queryRaw<
      Array<{
        owner_address: string;
        methodology: string;
        total_tonnes: Decimal;
        retirement_count: bigint;
      }>
    >`
      SELECT owner_address,
             methodology,
             total_tonnes,
             retirement_count
      FROM mv_portfolio_methodology_dist
      WHERE owner_address = ${address}
      ORDER BY total_tonnes DESC
    `;
  }

  private async queryVintageSpread(address: string) {
    return this.prisma.$queryRaw<
      Array<{
        owner_address: string;
        vintage_year: number;
        total_tonnes: Decimal;
        retirement_count: bigint;
      }>
    >`
      SELECT owner_address,
             vintage_year,
             total_tonnes,
             retirement_count
      FROM mv_portfolio_vintage_spread
      WHERE owner_address = ${address}
      ORDER BY vintage_year ASC
    `;
  }

  private async queryAvgPrice(address: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        owner_address: string;
        avg_price_per_credit: Decimal | null;
        min_price_per_credit: Decimal | null;
        max_price_per_credit: Decimal | null;
        retirement_count: bigint;
      }>
    >`
      SELECT owner_address,
             avg_price_per_credit,
             min_price_per_credit,
             max_price_per_credit,
             retirement_count
      FROM mv_portfolio_avg_price
      WHERE owner_address = ${address}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Time-period breakdown (live query — not materialized, simpler to keep fresh)
  // ─────────────────────────────────────────────────────────────────────────────

  private async queryTimePeriodBreakdown(
    address: string,
    period: TimePeriod,
  ): Promise<TimePeriodBreakdown[]> {
    // Fetch all retirements for this address and bucket in-process.
    // The groupBy clause in Prisma cannot express DATE_TRUNC groupings,
    // so we pull the raw rows and bucket them with minimal JS arithmetic.
    // For portfolios of up to 10,000 credits this is fast enough (< 5 ms).
    const rows = await this.prisma.retirementRecord.findMany({
      where: { retiredBy: address },
      select: {
        retiredAt: true,
        amount: true,
        isValid: true,
      },
      orderBy: { retiredAt: 'asc' },
    });

    if (rows.length === 0) return [];

    const buckets = new Map<
      string,
      { totalPurchased: number; totalRetired: number; retirementCount: number }
    >();

    for (const row of rows) {
      const label = formatPeriodLabel(row.retiredAt, period);
      const existing = buckets.get(label) ?? {
        totalPurchased: 0,
        totalRetired: 0,
        retirementCount: 0,
      };
      const tonnes = toNumber(row.amount);
      existing.totalPurchased += tonnes;
      if (row.isValid) existing.totalRetired += tonnes;
      existing.retirementCount += 1;
      buckets.set(label, existing);
    }

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, data]) => ({
        period: label,
        totalPurchased: Math.round(data.totalPurchased * 100) / 100,
        totalRetired: Math.round(data.totalRetired * 100) / 100,
        retirementCount: data.retirementCount,
      }));
  }
}
