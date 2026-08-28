import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { RedisService } from "../redis/redis.service";
import { IsString, IsInt, IsPositive } from "class-validator";
import { Type } from "class-transformer";

const BENCHMARK_TTL = 300; // 5 minutes — matches README "Price cache TTL: 24 hours" target;
                            // set to 5 min per task requirements

// ── DTOs ──────────────────────────────────────────────────────────────────────

export class SubmitMonitoringDto {
  @IsString() projectId: string;
  @IsString() period: string;
  @IsInt() @IsPositive() @Type(() => Number) tonnesVerified: number;
  @IsInt() @Type(() => Number) methodologyScore: number;
  @IsString() satelliteCid: string;
  @IsString() submittedBy: string;
}

export class UpdatePriceDto {
  @IsString() methodology: string;
  @IsInt() @Type(() => Number) vintageYear: number;
  @IsString() priceUsdc: string;
}

export class FlagProjectDto {
  @IsString() projectId: string;
  @IsString() reason: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class OracleService {
  private readonly logger = new Logger(OracleService.name);

  /**
   * In-memory fallback price store.
   * Used when Redis is unavailable. Keys: `${methodology}:${vintageYear}`
   */
  private readonly priceStore = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async submitMonitoring(dto: SubmitMonitoringDto) {
    return this.prisma.monitoringData.upsert({
      where:  { projectId_period: { projectId: dto.projectId, period: dto.period } },
      update: {
        tonnesVerified:   dto.tonnesVerified,
        methodologyScore: dto.methodologyScore,
        satelliteCid:     dto.satelliteCid,
      },
      create: {
        projectId:        dto.projectId,
        period:           dto.period,
        tonnesVerified:   dto.tonnesVerified,
        methodologyScore: dto.methodologyScore,
        satelliteCid:     dto.satelliteCid,
        submittedBy:      dto.submittedBy,
      },
    });
  }

  async getStatus(projectId: string) {
    const latest = await this.prisma.monitoringData.findFirst({
      where:   { projectId },
      orderBy: { submittedAt: "desc" },
    });

    const FRESHNESS_MS = 365 * 24 * 60 * 60 * 1000;
    const isCurrent = latest
      ? Date.now() - latest.submittedAt.getTime() <= FRESHNESS_MS
      : false;

    return {
      projectId,
      lastSubmittedAt: latest?.submittedAt ?? null,
      isCurrent,
      latestScore: latest?.methodologyScore ?? null,
    };
  }

  /**
   * Store a benchmark price for a methodology + vintage combination.
   * Called by the oracle price feed (POST /oracle/price).
   * Caches the result in Redis and updates the in-memory fallback store.
   */
  async updateBenchmarkPrice(dto: UpdatePriceDto): Promise<void> {
    const key = this.benchmarkCacheKey(dto.methodology, dto.vintageYear);

    // Persist in memory as a reliable fallback
    this.priceStore.set(`${dto.methodology}:${dto.vintageYear}`, dto.priceUsdc);

    // Persist in Redis with TTL
    await this.redis.set(key, { methodology: dto.methodology, vintageYear: dto.vintageYear, priceUsdc: dto.priceUsdc }, BENCHMARK_TTL);
    this.logger.log(`Benchmark price updated: ${dto.methodology}/${dto.vintageYear} = ${dto.priceUsdc} USDC`);
  }

  /**
   * Retrieve the benchmark price for a methodology + vintage.
   * Checks Redis first, then the in-memory fallback store.
   * Returns 404 if no price has been submitted.
   */
  async getBenchmarkPrice(methodology: string, vintageYear: number) {
    const key = this.benchmarkCacheKey(methodology, vintageYear);

    // ── Cache read ─────────────────────────────────────────────────────────
    const cached = await this.redis.get<{ methodology: string; vintageYear: number; priceUsdc: string }>(key);
    if (cached !== null) {
      this.logger.debug(`Cache HIT — ${key}`);
      return cached;
    }

    // ── In-memory fallback ─────────────────────────────────────────────────
    this.logger.debug(`Cache MISS — key: ${key}`);
    const fallback = this.priceStore.get(`${methodology}:${vintageYear}`);
    if (fallback) {
      // Re-warm Redis cache
      const data = { methodology, vintageYear, priceUsdc: fallback };
      await this.redis.set(key, data, BENCHMARK_TTL);
      return data;
    }

    throw new NotFoundException(
      `No benchmark price found for methodology "${methodology}" vintage ${vintageYear}`,
    );
  }

  async flagProject(dto: FlagProjectDto) {
    await this.prisma.carbonProject.update({
      where: { projectId: dto.projectId },
      data:  { status: "Suspended" },
    });
    return { flagged: true, projectId: dto.projectId, reason: dto.reason };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private benchmarkCacheKey(methodology: string, vintageYear: number): string {
    return `oracle:benchmark:${methodology}:${vintageYear}`;
  }
}
