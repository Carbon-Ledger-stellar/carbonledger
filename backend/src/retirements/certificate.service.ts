import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { IpfsUploadService } from "../uploads/ipfs-upload.service";

@Injectable()
export class CertificateService {
  private readonly logger = new Logger(CertificateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ipfsUpload: IpfsUploadService,
  ) {}

  /**
   * Generates a JSON certificate for a retirement, pins it to IPFS,
   * and updates the database record with the CID.
   */
  async generateAndPinCertificate(retirementId: string): Promise<{ cid: string }> {
    this.logger.log(`Processing certificate for retirement: ${retirementId}`);

    const retirement = await this.prisma.retirementRecord.findUnique({
      where: { retirementId },
      include: { project: true, batch: true },
    });

    if (!retirement) {
      throw new NotFoundException(`Retirement ${retirementId} not found`);
    }

    // 1. Create the certificate JSON structure matching on-chain RetirementCertificate
    // Expand serial range into full list to match Vec<u64> on-chain
    const start = parseInt(retirement.serialStart);
    const end = parseInt(retirement.serialEnd);
    const serialNumbers: number[] = [];
    if (!isNaN(start) && !isNaN(end)) {
      for (let s = start; s <= end; s++) {
        serialNumbers.push(s);
      }
    }

    const certificateData = {
      retirement_id: retirement.retirementId,
      credit_batch_id: retirement.batchId,
      project_id: retirement.projectId,
      amount: retirement.amount.toString(), // i128 on-chain
      retired_by: retirement.retiredBy,
      beneficiary: retirement.beneficiary,
      retirement_reason: retirement.retirementReason,
      vintage_year: retirement.vintageYear,
      serial_numbers: serialNumbers, // Match Vec<u64> representation exactly
      retired_at: Math.floor(retirement.retiredAt.getTime() / 1000), // Unix timestamp on-chain
      tx_hash: retirement.txHash,
      certificate_cid: "", // To be filled if we had it, but we are generating it now
      
      // Additional metadata for accessibility/UI
      metadata: {
        projectName: retirement.project.name,
        country: retirement.project.country,
        methodology: retirement.project.methodology,
        network: "Stellar",
        issuer: "CarbonLedger",
        generatedAt: new Date().toISOString(),
      }
    };

    const jsonBuffer = Buffer.from(JSON.stringify(certificateData, null, 2));
    const fileName = `certificate-${retirementId}.json`;

    // 2. Upload and pin to IPFS via Pinata
    const uploadResult = await this.ipfsUpload.uploadToPinata(
      fileName,
      "application/json",
      jsonBuffer,
      jsonBuffer.length,
      "certificate",
      retirement.id
    );

    this.logger.log(`Certificate pinned to IPFS: ${uploadResult.cid}`);

    // 3. Update RetirementRecord with the CID
    await this.prisma.retirementRecord.update({
      where: { retirementId },
      data: {
        certificateCid: uploadResult.cid,
      },
    });

    return { cid: uploadResult.cid };
  }
}
