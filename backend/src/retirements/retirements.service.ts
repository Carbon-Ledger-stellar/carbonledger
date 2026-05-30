import { Injectable, NotFoundException, BadRequestException, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { IpfsService } from "../common/ipfs.service";

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
  ) {}

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
    if (!r) throw new NotFoundException(`Retirement ${retirementId} not found`);
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
