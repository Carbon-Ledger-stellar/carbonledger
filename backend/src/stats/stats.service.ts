import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { ApiCacheService } from "../cache/api-cache.service";
import {
  STATS_CACHE_KEY,
  STATS_CACHE_TTL_SECONDS,
  STATS_AGGREGATE_CACHE_KEY,
  STATS_AGGREGATE_CACHE_TTL_SECONDS,
  statsLeaderboardCacheKey,
  STATS_LEADERBOARD_CACHE_TTL_SECONDS,
} from "../cache/cache.constants";

export interface LeaderboardEntry {
  rank: number;
  beneficiary: string;
  totalTonnes: number;
}

export interface AggregateStats {
  total_co2_retired: number;
  active_listings_count: number;
  verified_projects_count: number;
  total_usdc_volume: number;
}

@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly apiCache?: ApiCacheService,
  ) {}

  async getLeaderboard(year?: number): Promise<LeaderboardEntry[]> {
    if (this.apiCache) {
      return this.apiCache.getOrSet(
        statsLeaderboardCacheKey(year),
        STATS_LEADERBOARD_CACHE_TTL_SECONDS,
        'stats:leaderboard',
        () => this._getLeaderboardDb(year),
      );
    }
    return this._getLeaderboardDb(year);
  }

  private async _getLeaderboardDb(year?: number): Promise<LeaderboardEntry[]> {
    const where = year
      ? { retiredAt: { gte: new Date(`${year}-01-01`), lt: new Date(`${year + 1}-01-01`) } }
      : {};

    const rows = await this.prisma.retirementRecord.groupBy({
      by: ["beneficiary"],
      where,
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 50,
    });

    return rows.map((r, i) => ({
      rank: i + 1,
      beneficiary: r.beneficiary,
      totalTonnes: r._sum.amount ?? 0,
    }));
  }

  async getPlatformStats() {
    if (this.apiCache) {
      return this.apiCache.getOrSet(
        STATS_CACHE_KEY,
        STATS_CACHE_TTL_SECONDS,
        'stats:platform',
        () => this._getPlatformStatsDb(),
      );
    }
    return this._getPlatformStatsDb();
  }

  private async _getPlatformStatsDb() {
    const [projects, retirements, listings] = await Promise.all([
      this.prisma.carbonProject.aggregate({
        _sum: { totalCreditsIssued: true, totalCreditsRetired: true },
        _count: { _all: true },
        where: { status: "Verified" },
      }),
      this.prisma.retirementRecord.aggregate({ _sum: { amount: true } }),
      this.prisma.marketListing.aggregate({
        _count: { _all: true },
        where: { status: { in: ["Active", "PartiallyFilled"] } },
      }),
    ]);

    return {
      totalCreditsIssued:  projects._sum.totalCreditsIssued  ?? 0,
      totalCreditsRetired: projects._sum.totalCreditsRetired ?? 0,
      activeProjects:      projects._count._all,
      marketplaceVolume:   "0",
    };
  }

  async getAggregateStats(): Promise<AggregateStats> {
    if (this.apiCache) {
      return this.apiCache.getOrSet(
        STATS_AGGREGATE_CACHE_KEY,
        STATS_AGGREGATE_CACHE_TTL_SECONDS,
        'stats:aggregate',
        () => this._getAggregateStatsDb(),
      );
    }
    return this._getAggregateStatsDb();
  }

  private async _getAggregateStatsDb(): Promise<AggregateStats> {
    const [retirements, listings, projects, volumeResult] = await Promise.all([
      this.prisma.retirementRecord.aggregate({
        _sum: { amount: true },
      }),
      this.prisma.marketListing.count({
        where: { status: { in: ["Active", "PartiallyFilled"] } },
      }),
      this.prisma.carbonProject.count({
        where: { status: "Verified" },
      }),
      this.prisma.$queryRaw<[{ total: string | null }]>`
        SELECT SUM(CAST("pricePerCredit" AS numeric) * "amountAvailable")::text AS total
        FROM "MarketListing"
        WHERE status = 'Sold'
      `,
    ]);

    const totalUsdcVolume = parseFloat(volumeResult[0]?.total ?? "0") || 0;

    return {
      total_co2_retired: retirements._sum.amount?.toNumber() ?? 0,
      active_listings_count: listings,
      verified_projects_count: projects,
      total_usdc_volume: totalUsdcVolume,
    };
  }
}
