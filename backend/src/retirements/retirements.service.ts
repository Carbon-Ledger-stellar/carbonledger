import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { IpfsService } from "../common/ipfs.service";
import { RetireCreditsDto } from "./retirements.dto";
import { QueueService } from "../queue/queue.service";
import { JobType } from "../queue/queue.constants";
import { v4 as uuidv4 } from "uuid";
import { WebhookService } from "../webhook/webhook.service";

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
    private readonly queueService: QueueService,
    @Optional() private readonly webhookService?: WebhookService,
  ) {}

  async retireCredits(dto: RetireCreditsDto) {
    // Check if already retired (same batchId + retiredBy combination)
    const existing = await this.prisma.retirementRecord.findFirst({
      where: { batchId: dto.batchId, retiredBy: dto.retiredBy },
    });
    if (existing) {
      throw new ConflictException('Credits already retired (AlreadyRetired)');
    }

    const batch = await this.prisma.creditBatch.findUnique({ where: { batchId: dto.batchId } });
    if (!batch) throw new NotFoundException(`Credit batch ${dto.batchId} not found`);

    const retirementId = uuidv4();
    const retirement = await this.prisma.retirementRecord.create({
      data: {
        retirementId,
        batchId: dto.batchId,
        projectId: dto.projectId,
        amount: dto.amount,
        retiredBy: dto.retiredBy,
        beneficiary: dto.beneficiary,
        retirementReason: dto.retirementReason,
        vintageYear: batch.vintageYear,
        serialStart: batch.serialStart,
        serialEnd: batch.serialEnd,
        serialNumbers: [],
        txHash: dto.txHash,
      },
    });

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

    return { retirements, next_cursor, total_count };
  }

  async findOne(retirementId: string) {
    const r = await this.prisma.retirementRecord.findUnique({
      where: { retirementId },
      include: { project: true, batch: true },
    });
    if (!r) throw new NotFoundException('Retirement not found');
    return r;
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
}
