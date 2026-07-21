import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma.service';
import { QUEUE_NAME, JobType } from '../queue/queue.constants';
import { RedisService } from '../redis.service';
import { projectDetailCacheKey } from '../cache/cache.constants';
import {
    IsString, IsInt, IsPositive, Min, Max, Length, Matches, IsNumber, MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

const CID_REGEX = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/;

// ── Response shape for the /oracle/services/health endpoint ──────────────────

export interface OracleServiceStatus {
  status: 'healthy' | 'stale' | 'offline';
  lastSubmissionAt: Date | null;
  staleThresholdDays?: number;
  staleThresholdHours?: number;
}

export interface OracleServicesHealth {
  services: {
    verification_listener: OracleServiceStatus;
    price_oracle:          OracleServiceStatus;
    satellite_monitor:     OracleServiceStatus;
  };
  generatedAt: Date;
}

export class SubmitMonitoringDto {
  @IsString() @Length(1, 64) projectId: string;
  @IsString() @Length(1, 32) period: string;
  @IsInt() @IsPositive() @Type(() => Number) tonnesVerified: number;
  @IsInt() @Min(0) @Max(100) @Type(() => Number) methodologyScore: number;
  @IsString() @Matches(CID_REGEX, { message: 'satelliteCid must be a valid IPFS CID' })
  satelliteCid: string;
  @IsString() @Length(1, 64) @MaxLength(64) submittedBy: string;
}

export class UpdatePriceDto {
  @IsString() @Length(1, 64) methodology: string;
  @IsInt() @Min(1990) @Max(new Date().getFullYear() + 1) @Type(() => Number) vintageYear: number;
  @IsString() @Length(1, 32) priceUsdc: string;
}

export class FlagProjectDto {
  @IsString() @Length(1, 64) projectId: string;
  @IsString() @MaxLength(128) reason: string;
}

export class HoldPriceUpdateDto {
  @IsString() @Length(1, 64) methodology: string;
  @IsInt() @Type(() => Number) vintageYear: number;
  @IsString() @Length(1, 32) priceStroops: string;
}

@Injectable()
export class OracleService {
  private readonly logger = new Logger(OracleService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAME) private readonly queue: Queue,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Idempotent monitoring submission.
   * Upserts MonitoringData (unique on projectId+period), then enqueues
   * a Soroban submission job if this is a new record or a data change.
   */
  async submitMonitoring(dto: SubmitMonitoringDto) {
    const idempotencyKey = `monitoring:${dto.projectId}:${dto.period}`;

    // 1. Upsert monitoring data — idempotent by (projectId, period)
    const monitoring = await this.prisma.monitoringData.upsert({
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

    // 2. Log the oracle event — upsert so duplicate submissions don't create duplicate records
    const oracleUpdate = await this.prisma.oracleUpdate.upsert({
      where:  { idempotencyKey },
      update: {
        tonnesVerified:   dto.tonnesVerified,
        methodologyScore: dto.methodologyScore,
        status:           'pending',
        lastError:        null,
        updatedAt:        new Date(),
      },
      create: {
        idempotencyKey,
        type:             'monitoring',
        projectId:        dto.projectId,
        period:           dto.period,
        tonnesVerified:   dto.tonnesVerified,
        methodologyScore: dto.methodologyScore,
        status:           'pending',
      },
    });

    this.logger.log(
      `Oracle monitoring received projectId=${dto.projectId} period=${dto.period} ` +
      `tonnes=${dto.tonnesVerified} score=${dto.methodologyScore} ` +
      `oracleUpdateId=${oracleUpdate.id} at=${new Date().toISOString()}`,
    );

    // 3. Enqueue Soroban submission with exponential backoff
    await this.queue.add(
      JobType.ORACLE_SUBMISSION,
      { oracleUpdateId: oracleUpdate.id, type: 'monitoring', ...dto },
      {
        jobId:   `oracle-monitoring-${idempotencyKey}`, // deduplication key
        attempts: 5,
        backoff:  { type: 'exponential', delay: 5000 },
        removeOnComplete: false,
        removeOnFail:     false,
      },
    );

    return monitoring;
  }

  /**
   * Idempotent price update submission.
   */
  async submitPrice(dto: UpdatePriceDto) {
    const idempotencyKey = `price:${dto.methodology}:${dto.vintageYear}`;

    const oracleUpdate = await this.prisma.oracleUpdate.upsert({
      where:  { idempotencyKey },
      update: { priceUsdc: dto.priceUsdc, status: 'pending', lastError: null, updatedAt: new Date() },
      create: {
        idempotencyKey,
        type:        'price',
        methodology: dto.methodology,
        vintageYear: dto.vintageYear,
        priceUsdc:   dto.priceUsdc,
        status:      'pending',
      },
    });

    this.logger.log(
      `Oracle price received methodology=${dto.methodology} vintage=${dto.vintageYear} ` +
      `price=${dto.priceUsdc} oracleUpdateId=${oracleUpdate.id} at=${new Date().toISOString()}`,
    );

    await this.queue.add(
      JobType.ORACLE_SUBMISSION,
      { oracleUpdateId: oracleUpdate.id, type: 'price', ...dto },
      {
        jobId:    `oracle-price-${idempotencyKey}`,
        attempts: 5,
        backoff:  { type: 'exponential', delay: 5000 },
        removeOnComplete: false,
        removeOnFail:     false,
      },
    );

    return { received: true, oracleUpdateId: oracleUpdate.id };
  }

  async getStatus(projectId: string) {
    const latest = await this.prisma.monitoringData.findFirst({
      where:   { projectId },
      orderBy: { submittedAt: 'desc' },
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
   * Aggregate health status for all three oracle services.
   *
   * Freshness thresholds (per spec):
   *   - verification_listener / satellite_monitor → stale after 365 days
   *   - price_oracle                              → stale after 24 hours
   *
   * Returns 200 even when services are stale; callers inspect the `status`
   * field per service.  The response is intended to be cached for 30 seconds
   * by the controller.
   */
  async getServicesHealth(): Promise<OracleServicesHealth> {
    const now = Date.now();

    const MONITORING_STALE_MS = 365 * 24 * 60 * 60 * 1000; // 365 days
    const PRICE_STALE_MS      =       24 * 60 * 60 * 1000; // 24 hours

    // ── Verification listener: last 'monitoring' oracle update ──────────────
    const lastMonitoring = await this.prisma.oracleUpdate.findFirst({
      where:   { type: 'monitoring' },
      orderBy: { updatedAt: 'desc' },
    });

    // ── Price oracle: last 'price' oracle update ─────────────────────────────
    const lastPrice = await this.prisma.oracleUpdate.findFirst({
      where:   { type: 'price' },
      orderBy: { updatedAt: 'desc' },
    });

    // ── Satellite monitor: last monitoring data submission (satellite data
    //    arrives via the monitoring pipeline and carries a satelliteCid) ──────
    const lastSatellite = await this.prisma.monitoringData.findFirst({
      where:   { satelliteCid: { not: '' } },
      orderBy: { submittedAt: 'desc' },
    });

    const deriveStatus = (
      lastTs: Date | null,
      staleMs: number,
    ): 'healthy' | 'stale' | 'offline' => {
      if (!lastTs) return 'offline';
      return now - lastTs.getTime() <= staleMs ? 'healthy' : 'stale';
    };

    const verificationLastAt = lastMonitoring?.updatedAt ?? null;
    const priceLastAt        = lastPrice?.updatedAt      ?? null;
    const satelliteLastAt    = lastSatellite?.submittedAt ?? null;

    return {
      services: {
        verification_listener: {
          status:              deriveStatus(verificationLastAt, MONITORING_STALE_MS),
          lastSubmissionAt:    verificationLastAt,
          staleThresholdDays:  365,
        },
        price_oracle: {
          status:              deriveStatus(priceLastAt, PRICE_STALE_MS),
          lastSubmissionAt:    priceLastAt,
          staleThresholdHours: 24,
        },
        satellite_monitor: {
          status:              deriveStatus(satelliteLastAt, MONITORING_STALE_MS),
          lastSubmissionAt:    satelliteLastAt,
          staleThresholdDays:  365,
        },
      },
      generatedAt: new Date(),
    };
  }

  async flagProject(dto: FlagProjectDto) {
    await this.prisma.carbonProject.update({
      where: { projectId: dto.projectId },
      data:  { status: 'Suspended' },
    });
    await this.redisService.del(projectDetailCacheKey(dto.projectId));
    this.logger.warn(
      `Project flagged projectId=${dto.projectId} reason="${dto.reason}" at=${new Date().toISOString()}`,
    );
    return { flagged: true, projectId: dto.projectId, reason: dto.reason };
  }

  async holdPriceUpdate(dto: HoldPriceUpdateDto) {
    return this.prisma.priceApproval.create({
      data: {
        methodology:  dto.methodology,
        vintageYear:  dto.vintageYear,
        priceStroops: dto.priceStroops,
        deviation:    dto.deviation,
        status:       'Pending',
      },
    });
  }

  async getPriceApprovals() {
    return this.prisma.priceApproval.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async approvePriceUpdate(id: string) {
    return this.prisma.priceApproval.update({ where: { id }, data: { status: 'Approved' } });
  }

  async rejectPriceUpdate(id: string, reason?: string) {
    return this.prisma.priceApproval.update({ where: { id }, data: { status: 'Rejected', reason } });
  }
}
