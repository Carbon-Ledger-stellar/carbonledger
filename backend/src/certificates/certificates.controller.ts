import {
  Controller,
  Get,
  Param,
  Res,
  NotFoundException,
  Header,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
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

    // Most recent signed certificate record for this retirement (#594).
    const signedCert = await this.prisma.retirementCertificate.findFirst({
      where: { retirementId: retirement.id },
      orderBy: { createdAt: 'desc' },
    });

    // Reconstructs exactly the object CertificateSigningService signed
    // (certificates/certificate.processor.ts) — save this as JSON and run
    // `node backend/scripts/verify-certificate.js <file> Stellar.toml` to
    // verify the signature offline, trusting only Stellar.toml.
    const signedCertificate =
      signedCert?.issuerSignature && signedCert.issuerPublicKey
        ? {
            retirement_id: retirement.retirementId,
            project_id: retirement.projectId,
            beneficiary: retirement.beneficiary,
            amount: retirement.amount.toString(),
            retirement_reason: retirement.retirementReason,
            retired_at: Math.floor(retirement.retiredAt.getTime() / 1000),
            serial_start: retirement.serialStart,
            serial_end: retirement.serialEnd,
            vintage_year: retirement.vintageYear,
            tx_hash: retirement.txHash,
            issuer_signature: signedCert.issuerSignature,
            issuer_public_key: signedCert.issuerPublicKey,
          }
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
      contentHash: signedCert?.contentHash ?? null,
      issuerSignature: signedCert?.issuerSignature ?? null,
      issuerPublicKey: signedCert?.issuerPublicKey ?? null,
      signedCertificate,
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
}
