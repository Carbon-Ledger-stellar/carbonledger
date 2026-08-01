import {
  Controller,
  Get,
  Param,
  Res,
  NotFoundException,
  ConflictException,
  ServiceUnavailableException,
  Header,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Response } from 'express';
import { Public } from '../auth/decorators';
import { PrismaService } from '../prisma.service';
import { CertificateService } from './certificate.service';
import { PinataService } from './pinata.service';

@Controller('certificates')
export class CertificatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly certificateService: CertificateService,
    private readonly pinataService: PinataService,
  ) {}

  /**
   * Public endpoint to retrieve certificate metadata by retirement ID.
   * Required for external audits and transparency.
   */
  @Get(':retirementId')
  @Public()
  async getCertificate(@Param('retirementId') retirementId: string) {
    const retirement = await this.prisma.retirementRecord.findUnique({
      where: { retirementId },
      include: { project: true },
    });

    if (!retirement) {
      throw new NotFoundException(`Retirement ${retirementId} not found`);
    }

    const stellarNetwork =
      process.env.STELLAR_NETWORK === 'public' ? 'public' : 'testnet';
    const verificationUrl = retirement.txHash
      ? `https://stellar.expert/explorer/${stellarNetwork}/tx/${retirement.txHash}`
      : null;

    return {
      retirementId: retirement.retirementId,
      amount: retirement.amount.toString(),
      retiredBy: retirement.retiredBy,
      beneficiary: retirement.beneficiary,
      retirementReason: retirement.retirementReason,
      vintageYear: retirement.vintageYear,
      serialNumbers: retirement.serialNumbers,
      serialStart: retirement.serialStart,
      serialEnd: retirement.serialEnd,
      txHash: retirement.txHash,
      retiredAt: retirement.retiredAt,
      projectId: retirement.projectId,
      batchId: retirement.batchId,
      certificateCid: retirement.certificateCid,
      certificateStatus: retirement.certificateStatus,
      certificateUrl: retirement.certificateUrl,
      certificateGeneratedAt: retirement.certificateGeneratedAt,
      isValid: retirement.isValid,
      validatedAt: retirement.validatedAt,
      verificationUrl,
      ipfsUrl: retirement.certificateCid
        ? this.pinataService.getPublicUrl(retirement.certificateCid)
        : null,
      project: {
        name: retirement.project.name,
        country: retirement.project.country,
        methodology: retirement.project.methodology,
      },
    };
  }

  /**
   * Returns the PDF certificate for a given retirement.
   * Tries to fetch from IPFS first; falls back to on-demand generation.
   */
  @Get(':retirementId/pdf')
  @Public()
  @Header('Content-Type', 'application/pdf')
  @Header(
    'Cache-Control',
    'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600',
  )
  async getPdf(
    @Param('retirementId') retirementId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const retirement = await this.prisma.retirementRecord.findUnique({
      where: { retirementId },
      include: { project: true, batch: true },
    });

    if (!retirement) {
      throw new NotFoundException(
        `Retirement ${retirementId} not found`,
      );
    }

    // Try to fetch from IPFS if we have a CID
    if (retirement.certificateCid) {
      try {
        const response = await fetch(
          this.pinataService.getPublicUrl(retirement.certificateCid),
        );
        if (response.ok) {
          const pdfBuffer = Buffer.from(await response.arrayBuffer());
          res.setHeader(
            'Content-Disposition',
            `inline; filename="certificate-${retirementId}.pdf"`,
          );
          res.setHeader('Content-Length', pdfBuffer.length);
          res.setHeader('X-Certificate-Source', 'ipfs');
          return pdfBuffer;
        }
      } catch (err) {
        // IPFS fetch failed — fall through to on-demand generation
      }
    }

    // Generate on demand
    const pdfBuffer = await this.certificateService.generatePdf({
      retirementId: retirement.retirementId,
      beneficiary: retirement.beneficiary,
      amount: Number(retirement.amount),
      projectName: retirement.project.name,
      retirementReason: retirement.retirementReason,
      retiredAt: retirement.retiredAt,
      serialNumbers: retirement.serialNumbers,
      serialStart: retirement.serialStart,
      serialEnd: retirement.serialEnd,
      vintageYear: retirement.vintageYear,
      txHash: retirement.txHash,
    });

    res.setHeader(
      'Content-Disposition',
      `inline; filename="certificate-${retirementId}.pdf"`,
    );
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('X-Certificate-Source', 'generated');
    return pdfBuffer;
  }

  /**
   * Returns the certificate generation status for a given retirement.
   */
  @Get(':retirementId/status')
  @Public()
  @HttpCode(HttpStatus.OK)
  async getStatus(@Param('retirementId') retirementId: string) {
    const retirement = await this.prisma.retirementRecord.findUnique({
      where: { retirementId },
      select: {
        retirementId: true,
        certificateStatus: true,
        certificateCid: true,
        certificateUrl: true,
        certificateRetries: true,
        certificateFailedAt: true,
        certificateGeneratedAt: true,
      },
    });

    if (!retirement) {
      throw new NotFoundException(
        `Retirement ${retirementId} not found`,
      );
    }

    const statusMap: Record<string, string> = {
      pending_certificate: 'pending',
      generating: 'pending',
      completed: 'ready',
      failed: 'error',
    };

    return {
      retirementId: retirement.retirementId,
      status: statusMap[retirement.certificateStatus] ?? 'pending',
      cid: retirement.certificateCid,
      url: retirement.certificateUrl,
      retries: retirement.certificateRetries,
      generatedAt: retirement.certificateGeneratedAt,
      failedAt: retirement.certificateFailedAt,
    };
  }

  /**
   * Retrieves a certificate's pinned content by IPFS CID and cryptographically
   * verifies it against the content hash recorded at generation time (#600).
   *
   * - 404 if no certificate was ever pinned under this CID.
   * - 502 if the content can't currently be fetched from IPFS.
   * - 409 if the fetched content's hash doesn't match what was recorded
   *   (tampering, or the gateway served the wrong content).
   * - 200 with `{ valid: true, ... }` otherwise.
   *
   * GET /certificates/:cid/verify
   */
  @Get(':cid/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  async verifyByCid(@Param('cid') cid: string) {
    const retirement = await this.prisma.retirementRecord.findFirst({
      where: { certificateContentCid: cid },
    });

    if (!retirement) {
      throw new NotFoundException(`No certificate found for CID ${cid}`);
    }

    let content: Buffer;
    try {
      const response = await fetch(this.pinataService.getPublicUrl(cid));
      if (!response.ok) {
        throw new Error(`IPFS gateway responded with HTTP ${response.status}`);
      }
      content = Buffer.from(await response.arrayBuffer());
    } catch (err) {
      throw new ServiceUnavailableException(
        `Failed to retrieve content for CID ${cid} from IPFS: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const actualHash = createHash('sha256').update(content).digest('hex');
    const expectedHash = retirement.certificateContentHash;

    if (!expectedHash || actualHash !== expectedHash) {
      throw new ConflictException({
        valid: false,
        cid,
        retirementId: retirement.retirementId,
        message: expectedHash
          ? 'Content hash mismatch — the pinned content does not match what was recorded at ' +
            'generation time. This certificate may have been tampered with.'
          : 'No content hash was recorded for this certificate — cannot verify integrity.',
        expectedHash,
        actualHash,
      });
    }

    return {
      valid: true,
      cid,
      retirementId: retirement.retirementId,
      contentHash: actualHash,
      message: 'Certificate content integrity verified',
      verifiedAt: new Date().toISOString(),
    };
  }
}
