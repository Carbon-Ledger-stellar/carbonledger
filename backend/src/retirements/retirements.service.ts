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
import { CertificateSigningService } from "../common/certificate-signing.service";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import { QueueService } from "../queue/queue.service";
import { JobType } from "../queue/queue.constants";
import { sanitizeRetirementPayload, sanitizeRetirementForResponse } from "../common/sanitization.util";

import { Optional } from "@nestjs/common";
import { EventSourcingService } from "../events/event-sourcing.service";
import { CreditEventType } from "../events/credit-event.types";
import { WebhookService } from "../webhook/webhook.service";
import { buildCursorWhere, createOpaqueCursor, decodeCursor, normalizePaginationLimit } from "../common/cursor-pagination";

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
  data: any[];
  retirements: any[];
  total: number;
  total_count: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset?: number | null;
  next_cursor?: string;
  prev_cursor?: string;
}

@Injectable()
export class RetirementsService {
  private readonly logger = new Logger(RetirementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ipfsService: IpfsService,
    private readonly certificateService: CertificateService,
    private readonly queueService: QueueService,
    private readonly certificateSigning: CertificateSigningService,
    @Optional() private readonly eventSourcing?: EventSourcingService,
    @Optional() private readonly webhookService?: WebhookService,
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

    if (this.eventSourcing) {
      await this.eventSourcing.recordEvent({
        creditBatchId: dto.batchId,
        eventType: CreditEventType.RETIRE,
        actor: dto.retiredBy,
        oldState: { status: batch.status ?? 'Active' },
        newState: {
          batchId: dto.batchId,
          amountRetired: dto.amount,
          status: 'Retired',
          beneficiary: dto.beneficiary,
        },
        txHash: dto.txHash,
      }).catch(() => undefined);
    }

    // Enqueue certificate generation job via BullMQ for async PDF generation
    try {
      await this.queueService.enqueue(JobType.CERTIFICATE_GENERATION, {
        retirementId,
      });
      this.logger.log(`Certificate generation job enqueued for ${retirementId}`);
    } catch (err: any) {
      this.logger.warn(`Failed to enqueue certificate generation for ${retirementId}: ${err.message}`);
      // Don't fail retirement creation if queue enqueue fails
    }

    // Dispatch webhook: retirement.confirmed
    try {
      if (this.webhookService) {
        await this.webhookService.dispatch('retirement.confirmed', {
          retirementId: retirement.retirementId,
          batchId: retirement.batchId,
          projectId: retirement.projectId,
          amount: Number(retirement.amount),
          retiredBy: retirement.retiredBy,
          beneficiary: retirement.beneficiary,
          vintageYear: retirement.vintageYear,
          txHash: retirement.txHash,
          retiredAt: retirement.retiredAt.toISOString(),
        });
      }
    } catch (webhookError) {
      this.logger.warn(`Failed to dispatch webhook: ${webhookError instanceof Error ? webhookError.message : String(webhookError)}`);
    }

    return {
      retirementId: retirement.retirementId,
      txHash: retirement.txHash,
      certificateCid: null,
      certificateUrl: null,
      certificateStatus: 'pending_certificate',
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

  async bulkRetireCreditsFromCsv(dto: { csv: string; retiredBy: string }) {
    const rows = this.parseCsvRows(dto.csv);
    if (rows.length === 0) {
      throw new BadRequestException('CSV contains no retirements');
    }

    const normalized = await this.validateBulkCsvRows(rows, dto.retiredBy);
    const accepted = normalized.validItems;
    const rejected = normalized.invalidItems;

    const largeBatch = accepted.length > 100;
    if (largeBatch) {
      const jobId = `bulk-csv-${createHash('sha256').update(`${dto.retiredBy}:${dto.csv}`).digest('hex')}`;
      await this.queueService.enqueue(JobType.BULK_RETIREMENT, {
        items: accepted.map((item) => ({
          batchId: item.batchId,
          amount: item.amount,
          beneficiary: item.beneficiary,
          reason: item.reason,
        })),
        beneficiary: dto.retiredBy,
        retirementReason: 'Bulk CSV retirement',
        retiredBy: dto.retiredBy,
        requestId: jobId,
      }, { jobId });

      return {
        status: 'queued',
        jobId,
        acceptedCount: accepted.length,
        rejectedCount: rejected.length,
        rejected,
      };
    }

    const executed = await this.executeBulkRetirements({
      items: accepted.map((item) => ({
        batchId: item.batchId,
        amount: item.amount,
        beneficiary: item.beneficiary,
        reason: item.reason,
      })),
      beneficiary: dto.retiredBy,
      retirementReason: 'Bulk CSV retirement',
      retiredBy: dto.retiredBy,
    }, accepted as unknown as NormalizedBulkItem[]);

    return {
      status: 'completed',
      accepted: executed,
      rejected,
    };
  }

  async getBulkCsvStatus(jobId: string) {
    const job = await this.queueService.getJobStatus(jobId);
    return job ?? { jobId, state: 'missing' };
  }

  async getCertificateStatus(retirementId: string, retiredBy?: string) {
    const retirement = await this.prisma.retirementRecord.findFirst({
      where: { retirementId, ...(retiredBy ? { retiredBy } : {}) },
      select: {
        retirementId: true,
        certificateStatus: true,
        certificateRetries: true,
        certificateCid: true,
        certificateUrl: true,
        certificateGeneratedAt: true,
        certificateFailedAt: true,
      },
    });

    if (!retirement) throw new NotFoundException('Retirement not found');
    return retirement;
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

  async findAll(cursor?: string, limit = 20, offset = 0, retiredBy?: string): Promise<PaginatedRetirementsResponse> {
    const take = normalizePaginationLimit(limit, 100);
    const safeOffset = typeof offset === 'number' && offset >= 0 ? offset : 0;
    const where: any = retiredBy ? { retiredBy, deletedAt: null } : { deletedAt: null };
    const decodedCursor = decodeCursor(cursor);
    const cursorWhere = decodedCursor ? buildCursorWhere(decodedCursor) : undefined;

    const [retirements, total_count] = await Promise.all([
      this.prisma.retirementRecord.findMany({
        where: cursorWhere ? { ...where, ...cursorWhere } : where,
        orderBy: [{ retiredAt: "desc" }, { id: "desc" }],
        take: take + 1,
        skip: decodedCursor ? 0 : safeOffset,
      }),
      this.prisma.retirementRecord.count({ where }),
    ]);

    const hasMore = retirements.length > take;
    const next_cursor = hasMore ? createOpaqueCursor(retirements[take - 1].id, retirements[take - 1].retiredAt) : undefined;
    const prev_cursor = decodedCursor && retirements.length > 0 ? createOpaqueCursor(retirements[0].id, retirements[0].retiredAt) : undefined;
    if (hasMore) retirements.pop();

    const sanitized = retirements.map((retirement) => sanitizeRetirementForResponse(retirement as Record<string, unknown>));

    return {
      data: sanitized,
      retirements: sanitized,
      total: total_count,
      total_count,
      limit: take,
      offset: safeOffset,
      hasMore,
      nextOffset: hasMore ? safeOffset + take : null,
      next_cursor,
      prev_cursor,
    };
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
    offset?: number;
  }): Promise<PaginatedRetirementsResponse> {
    const { search, projectId, retiredBy, vintageYear, cursor, limit = 20, offset = 0 } = query;
    const take = normalizePaginationLimit(limit, 100);
    const safeOffset = typeof offset === 'number' && offset >= 0 ? offset : 0;

    if (!search) {
      return this.findAll(cursor, take, safeOffset, retiredBy);
    }

    const decodedCursor = decodeCursor(cursor);
    const cursorWhere = decodedCursor ? buildCursorWhere(decodedCursor) : undefined;
    const where: any = {
      deletedAt: null,
      OR: [
        { beneficiary: { contains: search, mode: 'insensitive' } },
        { retirementReason: { contains: search, mode: 'insensitive' } },
      ],
    };

    if (projectId) { where.projectId = projectId; }
    if (retiredBy) { where.retiredBy = retiredBy; }
    if (vintageYear) { where.vintageYear = vintageYear; }

    const [rows, total_count] = await Promise.all([
      this.prisma.retirementRecord.findMany({
        where: cursorWhere ? { ...where, ...cursorWhere } : where,
        take: take + 1,
        skip: decodedCursor ? 0 : safeOffset,
        orderBy: [{ retiredAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.retirementRecord.count({ where }),
    ]);

    const hasMore = rows.length > take;
    const next_cursor = hasMore ? createOpaqueCursor(rows[take - 1].id, rows[take - 1].retiredAt) : undefined;
    const prev_cursor = decodedCursor && rows.length > 0 ? createOpaqueCursor(rows[0].id, rows[0].retiredAt) : undefined;
    if (hasMore) rows.pop();

    const sanitized = rows.map((retirement) => sanitizeRetirementForResponse(retirement as Record<string, unknown>));

    return {
      data: sanitized,
      retirements: sanitized,
      total: total_count,
      total_count,
      limit: take,
      offset: safeOffset,
      hasMore,
      nextOffset: hasMore ? safeOffset + take : null,
      next_cursor,
      prev_cursor,
    };
  }

  async findOne(retirementId: string) {
    const r = await this.prisma.retirementRecord.findFirst({
      where: { retirementId, deletedAt: null },
      include: { project: true, batch: true },
    });
    if (!r) throw new NotFoundException('Retirement not found');
    return sanitizeRetirementForResponse(r as Record<string, unknown>);
  }

  /**
   * Soft-delete a retirement record (#964). Kept out of default read paths
   * (findAll/searchRetirements/findOne) but recoverable by an admin until the
   * retention job purges it (AdminService#purgeDeletedRecords, 30 days).
   */
  async softDeleteRetirement(retirementId: string) {
    const retirement = await this.prisma.retirementRecord.findFirst({
      where: { retirementId, deletedAt: null },
    });
    if (!retirement) throw new NotFoundException(`Retirement ${retirementId} not found`);

    return this.prisma.retirementRecord.update({
      where: { id: retirement.id },
      data: { deletedAt: new Date() },
    });
  }

  /** Admin recovery (#964): un-hides a soft-deleted retirement record. */
  async restoreRetirement(retirementId: string) {
    const retirement = await this.prisma.retirementRecord.findFirst({
      where: { retirementId, deletedAt: { not: null } },
    });
    if (!retirement) throw new NotFoundException(`Deleted retirement ${retirementId} not found`);

    return this.prisma.retirementRecord.update({
      where: { id: retirement.id },
      data: { deletedAt: null },
    });
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

  /**
   * Verifies a certificate's Ed25519 `issuer_signature` (#594). Self-
   * contained: needs only the certificate JSON and the published signing
   * public key — no database lookup — mirroring how the standalone CLI
   * tool (scripts/verify-certificate.js) verifies.
   *
   * Also flags a mismatch between the certificate's embedded
   * `issuer_public_key` and the currently-published `CERTIFICATE_SIGNING_KEY`
   * as `keyIsCurrent: false` (rather than failing verification outright) so
   * certificates signed under a rotated-out key remain verifiable during
   * the rotation transition window — see CERTIFICATE_SIGNING.md.
   */
  verifyCertificateSignature(certificate: Record<string, unknown>) {
    const { issuer_signature, issuer_public_key, ...signedContent } = certificate ?? {};

    if (typeof issuer_signature !== "string" || typeof issuer_public_key !== "string") {
      return {
        valid: false,
        message: "Certificate is missing issuer_signature or issuer_public_key",
      };
    }

    const valid = CertificateSigningService.verify(signedContent, issuer_signature, issuer_public_key);

    const publishedKey = process.env.CERTIFICATE_SIGNING_KEY;
    const previousPublishedKey = process.env.CERTIFICATE_SIGNING_KEY_PREVIOUS;
    const keyIsCurrent = publishedKey ? issuer_public_key === publishedKey : undefined;
    const keyIsKnownPrevious = previousPublishedKey ? issuer_public_key === previousPublishedKey : false;

    return {
      valid,
      issuerPublicKey: issuer_public_key,
      keyIsCurrent,
      keyIsKnownPrevious,
      message: valid
        ? "Certificate signature is valid"
        : "Certificate signature is invalid — content may have been tampered with",
    };
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

  private parseCsvRows(csv: string): Array<{ batchId: string; amount: string; beneficiary: string; reason: string }> {
    const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return [];
    const header = lines[0].split(',').map((cell) => cell.trim().toLowerCase());
    const rows = lines.slice(1).map((line) => {
      const values = line.split(',').map((cell) => cell.trim());
      const row: Record<string, string> = {};
      header.forEach((key, index) => {
        row[key] = values[index] ?? '';
      });
      return {
        batchId: row.batchid ?? '',
        amount: row.amount ?? '',
        beneficiary: row.beneficiary ?? '',
        reason: row.reason ?? '',
      };
    });

    return rows;
  }

  private async validateBulkCsvRows(rows: Array<{ batchId: string; amount: string; beneficiary: string; reason: string }>, retiredBy: string) {
    const invalidItems: Array<{ row: number; error: string }> = [];
    const validItems: NormalizedBulkItem[] = [];

    const batchIds = rows.map((row) => row.batchId).filter(Boolean);
    const uniqueBatchIds = new Set(batchIds);
    if (uniqueBatchIds.size !== batchIds.length) {
      invalidItems.push({ row: 0, error: 'Each batchId must be unique in a CSV upload' });
    }

    const batches = await this.prisma.creditBatch.findMany({ where: { batchId: { in: [...uniqueBatchIds] } } });
    const batchMap = new Map(batches.map((batch) => [batch.batchId, batch]));
    const retiredBatchIds = new Set((await this.prisma.retirementRecord.findMany({ where: { retiredBy, batchId: { in: [...uniqueBatchIds] } }, select: { batchId: true } })).map((row) => row.batchId));

    rows.forEach((row, index) => {
      const amount = Number(row.amount);
      if (!row.batchId || !row.beneficiary || !row.reason || !Number.isFinite(amount) || amount <= 0) {
        invalidItems.push({ row: index + 2, error: 'Each row must include batchId, amount, beneficiary, and reason' });
        return;
      }

      const batch = batchMap.get(row.batchId);
      if (!batch) {
        invalidItems.push({ row: index + 2, error: `Credit batch ${row.batchId} not found` });
        return;
      }

      if (retiredBatchIds.has(row.batchId)) {
        invalidItems.push({ row: index + 2, error: `Credits already retired for batch ${row.batchId}` });
        return;
      }

      const batchAmount = this.batchAmountToNumber(batch.amount);
      if (amount > batchAmount) {
        invalidItems.push({ row: index + 2, error: `Cannot retire ${amount} from batch ${row.batchId} — only ${batchAmount} available` });
        return;
      }

      validItems.push({
        batchId: row.batchId,
        amount,
        beneficiary: row.beneficiary,
        reason: row.reason,
        batch,
      });
    });

    return { validItems, invalidItems };
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
