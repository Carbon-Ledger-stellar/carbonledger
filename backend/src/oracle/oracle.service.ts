import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma.service';
import { QUEUE_NAME, JobType } from '../queue/queue.constants';
import {
    IsString, IsInt, IsPositive, Min, Max, Length, Matches, IsNumber, MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

const CID_REGEX = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/;

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

  async flagProject(dto: FlagProjectDto) {
    await this.prisma.carbonProject.update({
      where: { projectId: dto.projectId },
      data:  { status: 'Suspended' },
    });
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
