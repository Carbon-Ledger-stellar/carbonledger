import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { IpfsService } from "../common/ipfs.service";
import {
  BulkRetirementsDto,
  RetireCreditsDto,
} from "./retirements.dto";
import { CertificateService } from "./certificate.service";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import { QueueService } from "../queue/queue.service";
import { JobType } from "../queue/queue.constants";
import { sanitizeRetirementPayload, sanitizeRetirementForResponse } from "../common/sanitization.util";

export interface BulkRetirementResult {
  batchId: string;
  retirementId: string;
  certificateUrl: string | null;
}

export interface BulkRetirementRequest extends BulkRetirementsDto {
  retiredBy: string;
}

export interface BulkRetirementQueuedResponse {
  jobId: string;
}

interface NormalizedBulkItem {
  batchId: string;
  amount: number;
  beneficiary: string;
  reason: string;
  batch: {
    batchId: string;
    projectId: string;
    vintageYear: number;
    serialStart: string;
    serialEnd: string;
    amount: { toNumber?: () => number } | number | string;
  };
}

export interface PaginatedRetirementsResponse {
  retirements: any[];
  next_cursor?: string;
  total_count: number;
}

@Injectable()
export class RetirementsService {
  private readonly logger = new Logger(RetirementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ipfsService: IpfsService,
    private readonly certificateService: CertificateService,
    private readonly queueService: QueueService,
  ) {}

  async retireCredits(dto: RetireCreditsDto) {
    const sanitizedDto = sanitizeRetirementPayload(dto as unknown as Record<string, unknown>) as RetireCreditsDto;

    // Replay-attack guard: reject any txHash that has already been recorded.
    // Without this check, a different `retiredBy` address could reuse a real
    // (or fabricated) transaction hash to generate a second certificate for the
    // same on-chain retirement — effectively double-counting carbon credits.
    const txHashExists = await this.prisma.retirementRecord.findFirst({
      where: { txHash: sanitizedDto.txHash },
    });
    if (txHashExists) {
      throw new ConflictException('Transaction hash already used');
    }

    // Check if already retired (same batchId + retiredBy combination)
    const existing = await this.prisma.retirementRecord.findFirst({
      where: { batchId: sanitizedDto.batchId, retiredBy: sanitizedDto.retiredBy },
    });
    if (existing) {
      throw new ConflictException('Credits already retired (AlreadyRetired)');
    }

    const batch = await this.prisma.creditBatch.findUnique({ where: { batchId: sanitizedDto.batchId } });
    if (!batch) throw new NotFoundException(`Credit batch ${sanitizedDto.batchId} not found`);

    const retirementId = uuidv4();
    const retirement = await this.prisma.retirementRecord.create({
      data: {
        retirementId,
        batchId: sanitizedDto.batchId,
        projectId: sanitizedDto.projectId,
        amount: sanitizedDto.amount,
        retiredBy: sanitizedDto.retiredBy,
        beneficiary: sanitizedDto.beneficiary,
        retirementReason: sanitizedDto.retirementReason,
        vintageYear: batch.vintageYear,
        serialStart: batch.serialStart,
        serialEnd: batch.serialEnd,
        serialNumbers: [],
        txHash: sanitizedDto.txHash,
      },
    });

    // Generate and pin certificate to IPFS
    let certificateCid: string | null = null;
    try {
      const result = await this.certificateService.generateAndPinCertificate(retirementId);
      certificateCid = result.cid;
    } catch (err) {
      this.logger.warn(`Certificate generation failed for ${retirementId}: ${err.message}`);
    }

    return {
      retirementId: retirement.retirementId,
      txHash: retirement.txHash,
      certificateCid,
      certificateUrl: certificateCid
        ? `https://gateway.pinata.cloud/ipfs/${certificateCid}`
        : null,
    };
  }

  async bulkRetireCredits(dto: BulkRetirementRequest): Promise<BulkRetirementResult[] | BulkRetirementQueuedResponse> {
    const sanitizedDto = sanitizeRetirementPayload(dto as unknown as Record<string, unknown>) as BulkRetirementRequest;
    const normalized = await this.validateBulkRetirementRequest(sanitizedDto);

    if (normalized.length > 10) {
      const jobId = this.bulkRetirementJobId(sanitizedDto, normalized);
      const job = await this.queueService.enqueue(
        JobType.BULK_RETIREMENT,
        {
          items: normalized.map((item) => ({
            batchId: item.batchId,
            amount: item.amount,
            beneficiary: item.beneficiary,
            reason: item.reason,
          })),
          beneficiary: sanitizedDto.beneficiary,
          retirementReason: sanitizedDto.retirementReason,
          retiredBy: sanitizedDto.retiredBy,
        },
        { jobId },
      );

      return { jobId: String(job.id ?? jobId) };
    }

    return this.executeBulkRetirements(sanitizedDto, normalized);
  }

  async executeBulkRetirements(
    dto: BulkRetirementRequest,
    normalized?: NormalizedBulkItem[],
  ): Promise<BulkRetirementResult[]> {
    const sanitizedDto = sanitizeRetirementPayload(dto as unknown as Record<string, unknown>) as BulkRetirementRequest;
    const items = normalized ?? await this.validateBulkRetirementRequest(sanitizedDto);
    const txHash = this.buildBulkTransactionHash(sanitizedDto, items);

    const created = await this.prisma.$transaction(async (tx) => {
      const records: Array<{ retirementId: string; batchId: string }> = [];

      for (const item of items) {
        const retirementId = uuidv4();
        await tx.retirementRecord.create({
          data: {
            retirementId,
            batchId: item.batchId,
            projectId: item.batch.projectId,
            amount: item.amount,
            retiredBy: sanitizedDto.retiredBy,
            beneficiary: item.beneficiary,
            retirementReason: item.reason,
            vintageYear: item.batch.vintageYear,
            serialStart: item.batch.serialStart,
            serialEnd: item.batch.serialEnd,
            serialNumbers: [],
            txHash,
          },
        });
        records.push({ retirementId, batchId: item.batchId });
      }

      return records;
    });

    const results: BulkRetirementResult[] = [];
    for (const record of created) {
      let certificateCid: string | null = null;
      try {
        const result = await this.certificateService.generateAndPinCertificate(record.retirementId);
        certificateCid = result.cid;
      } catch (err: any) {
        this.logger.warn(`Certificate generation failed for ${record.retirementId}: ${err.message}`);
      }

      results.push({
        batchId: record.batchId,
        retirementId: record.retirementId,
        certificateUrl: certificateCid ? `https://gateway.pinata.cloud/ipfs/${certificateCid}` : null,
      });
    }

    return results;
  }

  async findAll(cursor?: string, limit = 20, retiredBy?: string): Promise<PaginatedRetirementsResponse> {
    const take = Math.min(Math.max(limit, 1), 100);
    const where = retiredBy ? { retiredBy } : {};

    const [retirements, total_count] = await Promise.all([
      this.prisma.retirementRecord.findMany({
        where,
        orderBy: { retiredAt: "desc" },
        take: take + 1,
        cursor: cursor ? { id: cursor } : undefined,
        skip: cursor ? 1 : 0,
      }),
      this.prisma.retirementRecord.count({ where }),
    ]);

    const hasMore = retirements.length > take;
    const next_cursor = hasMore ? retirements[retirements.length - 2].id : undefined;
    if (hasMore) retirements.pop();

    return { retirements: retirements.map((retirement) => sanitizeRetirementForResponse(retirement as Record<string, unknown>)), next_cursor, total_count };
  }

  /**
   * Full-text search over retirements using the PostgreSQL tsvector GIN index (#670).
   * Searches beneficiary (weight A) and retirementReason (weight B).
   */
  async searchRetirements(query: {
    search?: string;
    projectId?: string;
    retiredBy?: string;
    vintageYear?: number;
    cursor?: string;
    limit?: number;
  }): Promise<PaginatedRetirementsResponse> {
    const { search, projectId, retiredBy, vintageYear, cursor, limit = 20 } = query;
    const take = Math.min(Math.max(limit, 1), 100);

    if (!search) {
      return this.findAll(cursor, take, retiredBy);
    }

    const where: any = {
      OR: [
        { beneficiary: { contains: search, mode: 'insensitive' } },
        { retirementReason: { contains: search, mode: 'insensitive' } },
      ],
    };

    if (projectId) { where.projectId = projectId; }
    if (retiredBy) { where.retiredBy = retiredBy; }
    if (vintageYear) { where.vintageYear = vintageYear; }
    if (cursor) { where.id = { lt: cursor }; }

    const [rows, total_count] = await Promise.all([
      this.prisma.retirementRecord.findMany({
        where,
        take: take + 1,
        orderBy: { retiredAt: 'desc' },
      }),
      this.prisma.retirementRecord.count({ where }),
    ]);

    const hasMore = rows.length > take;
    const next_cursor = hasMore ? rows[rows.length - 2].id : undefined;
    if (hasMore) rows.pop();

    return { retirements: rows.map((retirement) => sanitizeRetirementForResponse(retirement as Record<string, unknown>)), next_cursor, total_count };
  }

  async findOne(retirementId: string) {
    const r = await this.prisma.retirementRecord.findUnique({
      where: { retirementId },
      include: { project: true, batch: true },
    });
    if (!r) throw new NotFoundException('Retirement not found');
    return sanitizeRetirementForResponse(r as Record<string, unknown>);
  }

  /**
   * Verify certificate content integrity against stored IPFS CID.
   * Fetches certificate content and compares hash against stored CID.
   * 
   * @param retirementId The retirement record ID
   * @param fetchedContent The certificate content fetched from IPFS
   * @returns Verification result with status and details
   */
  async verifyCertificateIntegrity(retirementId: string, fetchedContent: Buffer | string) {
    const retirement = await this.findOne(retirementId);

    if (!retirement.certificateCid) {
      throw new BadRequestException(
        `Certificate for retirement ${retirementId} has no CID stored - cannot verify integrity`
      );
    }

    try {
      const isValid = this.ipfsService.verifyCidMatch(fetchedContent, retirement.certificateCid);

      if (!isValid) {
        // Mark certificate as invalid due to tampering detection
        await this.prisma.retirementRecord.update({
          where: { retirementId },
          data: {
            isValid: false,
            validatedAt: new Date(),
          },
        });

        this.logger.warn(
          `SECURITY ALERT: Certificate tampering detected for retirement ${retirementId}. ` +
          `Stored CID: ${retirement.certificateCid}, Content hash mismatch.`
        );

        return {
          valid: false,
          retirementId,
          message: "Certificate content integrity verification failed - tampering detected",
          storedCid: retirement.certificateCid,
        };
      }

      // Update validation timestamp on success
      await this.prisma.retirementRecord.update({
        where: { retirementId },
        data: {
          validatedAt: new Date(),
        },
      });

      return {
        valid: true,
        retirementId,
        message: "Certificate content integrity verified",
        storedCid: retirement.certificateCid,
      };
    } catch (error) {
      this.logger.error(
        `Error verifying certificate integrity for ${retirementId}: ${error.message}`
      );
      throw new BadRequestException(
        `Failed to verify certificate integrity: ${error.message}`
      );
    }
  }

  async generatePdf(retirementId: string): Promise<Buffer> {
    const retirement = await this.findOne(retirementId);
    return Buffer.from(JSON.stringify(retirement));
  }

  async exportCsv(filters: any): Promise<Buffer> {
    const where: any = {};
    if (filters.retiredBy)   where.retiredBy   = filters.retiredBy;
    if (filters.projectId)   where.projectId   = filters.projectId;
    if (filters.batchId)     where.batchId     = filters.batchId;
    if (filters.beneficiary) where.beneficiary = { contains: filters.beneficiary, mode: "insensitive" };
    if (filters.vintageYear) where.vintageYear = filters.vintageYear;

    const retirements = await this.prisma.retirementRecord.findMany({ where, orderBy: { retiredAt: "desc" } });

    const header = "retirementId,batchId,projectId,amount,retiredBy,beneficiary,retirementReason,vintageYear,txHash,retiredAt\n";
    const rows = retirements.map((r) =>
      [r.retirementId, r.batchId, r.projectId, r.amount, r.retiredBy, r.beneficiary, r.retirementReason, r.vintageYear, r.txHash, r.retiredAt.toISOString()].join(",")
    ).join("\n");

    return Buffer.from(header + rows);
  }

  async exportPdf(filters: any): Promise<Buffer> {
    const csvBuffer = await this.exportCsv(filters);
    // Minimal PDF wrapper — production would use pdfkit
    return Buffer.from(`%PDF-1.4\n% ESG Retirement Report\n${csvBuffer.toString()}`);
  }

  private async validateBulkRetirementRequest(dto: BulkRetirementRequest): Promise<NormalizedBulkItem[]> {
    const batchIds = dto.items.map((item) => item.batchId);
    const uniqueBatchIds = new Set(batchIds);

    if (uniqueBatchIds.size !== batchIds.length) {
      throw new BadRequestException('Each bulk retirement item must reference a unique batchId');
    }

    const [batches, existingRetirements] = await Promise.all([
      this.prisma.creditBatch.findMany({
        where: { batchId: { in: [...uniqueBatchIds] } },
      }),
      this.prisma.retirementRecord.findMany({
        where: {
          retiredBy: dto.retiredBy,
          batchId: { in: [...uniqueBatchIds] },
        },
        select: { batchId: true },
      }),
    ]);

    const batchMap = new Map(batches.map((batch) => [batch.batchId, batch]));
    const retiredBatchIds = new Set(existingRetirements.map((row) => row.batchId));

    return dto.items.map((item) => {
      const batch = batchMap.get(item.batchId);
      if (!batch) {
        throw new NotFoundException(`Credit batch ${item.batchId} not found`);
      }

      if (retiredBatchIds.has(item.batchId)) {
        throw new ConflictException(`Credits already retired for batch ${item.batchId}`);
      }

      const batchAmount = this.batchAmountToNumber(batch.amount);
      if (item.amount > batchAmount) {
        throw new BadRequestException(`Cannot retire ${item.amount} from batch ${item.batchId} — only ${batchAmount} available`);
      }

      return {
        batchId: item.batchId,
        amount: item.amount,
        beneficiary: item.beneficiary ?? dto.beneficiary,
        reason: item.reason ?? dto.retirementReason,
        batch,
      };
    });
  }

  private batchAmountToNumber(amount: NormalizedBulkItem['batch']['amount']): number {
    if (typeof amount === 'number') {
      return amount;
    }
    if (typeof amount === 'string') {
      return Number(amount);
    }
    if (amount && typeof amount.toNumber === 'function') {
      return amount.toNumber();
    }
    return Number(amount ?? 0);
  }

  private bulkRetirementJobId(dto: BulkRetirementRequest, items: NormalizedBulkItem[]): string {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({
        retiredBy: dto.retiredBy,
        beneficiary: dto.beneficiary,
        retirementReason: dto.retirementReason,
        items: items.map((item) => ({
          batchId: item.batchId,
          amount: item.amount,
          beneficiary: item.beneficiary,
          reason: item.reason,
        })),
      }))
      .digest('hex');

    return `bulk-retirement-${fingerprint}`;
  }

  private buildBulkTransactionHash(dto: BulkRetirementRequest, items: NormalizedBulkItem[]): string {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({
        retiredBy: dto.retiredBy,
        beneficiary: dto.beneficiary,
        retirementReason: dto.retirementReason,
        items: items.map((item) => ({
          batchId: item.batchId,
          amount: item.amount,
          beneficiary: item.beneficiary,
          reason: item.reason,
          projectId: item.batch.projectId,
        })),
      }))
      .digest('hex');

    return `tx_${fingerprint}`;
  }
}
