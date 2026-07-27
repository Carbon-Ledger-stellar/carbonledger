import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

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
  constructor(private readonly prisma: PrismaService) {}

  async getLeaderboard(year?: number): Promise<LeaderboardEntry[]> {
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
      marketplaceVolume:   "0", // Would sum completed purchase amounts
    };
  }

  async getAggregateStats(): Promise<AggregateStats> {
    const [retirements, listings, projects, soldListings] = await Promise.all([
      this.prisma.retirementRecord.aggregate({
        _sum: { amount: true },
      }),
      this.prisma.marketListing.count({
        where: { status: { in: ["Active", "PartiallyFilled"] } },
      }),
      this.prisma.carbonProject.count({
        where: { status: "Verified" },
      }),
      this.prisma.marketListing.findMany({
        where: { status: "Sold" },
        select: {
          pricePerCredit: true,
          amountAvailable: true,
        },
      }),
    ]);

    // Calculate USDC volume from sold listings
    // Note: amountAvailable represents the original amount since it's not updated on sale
    // In a real implementation, you'd track actual purchase amounts in a transaction table
    const totalUsdcVolume = soldListings.reduce((sum, listing) => {
      const price = parseFloat(listing.pricePerCredit);
      const amount = parseFloat(listing.amountAvailable.toString());
      return sum + (price * amount);
    }, 0);

    return {
      total_co2_retired: retirements._sum.amount?.toNumber() ?? 0,
      active_listings_count: listings,
      verified_projects_count: projects,
      total_usdc_volume: totalUsdcVolume,
    };
  }
}
