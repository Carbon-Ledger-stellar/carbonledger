import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Res,
  Request,
  ForbiddenException,
  HttpCode,
  Header,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { IsString } from 'class-validator';
import { RetirementsService } from './retirements.service';
import {
  ExportRetirementsDto,
  RetireCreditsDto,
  BulkRetirementsDto,
  CsvBulkRetirementsDto,
} from './retirements.dto';
import { Public, Roles } from '../auth/decorators';
import { QuotaBucket } from '../throttle';
import { ZkProofService } from './zk-proof.service';
import {
  CheckPolicies,
  PoliciesGuard,
  RetirementSubject,
  ZkProofSubject,
} from '../policies';
import { subject } from '@casl/ability';
import { AbilityFactory } from '../policies/ability.factory';

class VerifyCertificateDto {
  @IsString() retirementId: string;
  @IsString() content: string;
}

class VerifyCertificateSignatureDto {
  /**
   * The full certificate JSON as issued (including `issuer_signature` and
   * `issuer_public_key`). Verification is self-contained — no database
   * lookup is required, matching how the standalone CLI tool verifies.
   */
  certificate: Record<string, unknown>;
}

@Controller('retirements')
export class RetirementsController {
  constructor(
    private readonly retirementsService: RetirementsService,
    private readonly zkProofService: ZkProofService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  // Fix IDOR: require auth; scope list to the caller's own retirements
  @Get()
  findAll(
    @Request() req: any,
    @Query('cursor') cursor?: string,
    @Query('limit')  limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.retirementsService.findAll(
      cursor,
      limit ? Number(limit) : 20,
      offset ? Number(offset) : 0,
      req.user.publicKey,
    );
  }

  /**
   * Full-text search over retirements using the PostgreSQL tsvector GIN index (#670).
   * Scoped to the authenticated caller's retirements.
   */
  @Get('search')
  searchRetirements(
    @Request() req: any,
    @Query('search')      search?: string,
    @Query('projectId')   projectId?: string,
    @Query('vintageYear') vintageYear?: string,
    @Query('cursor')      cursor?: string,
    @Query('limit')       limit?: string,
    @Query('offset')      offset?: string,
  ) {
    return this.retirementsService.searchRetirements({
      search,
      projectId,
      retiredBy: req.user.publicKey,
      vintageYear: vintageYear ? Number(vintageYear) : undefined,
      cursor,
      limit: limit ? Number(limit) : 20,
      offset: offset ? Number(offset) : 0,
    });
  }

  @Post()
  @Roles('corporation', 'admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('retire', RetirementSubject))
  retireCredits(@Body() dto: RetireCreditsDto) {
    return this.retirementsService.retireCredits(dto);
  }

  /**
   * GET /retirements/:id
   *
   * Only the owner or admin may read a specific retirement record.
   * ABAC condition: RetirementSubject.retiredBy must match req.user.publicKey.
   */
  @Post('bulk')
  @Roles('corporation', 'admin')
  @QuotaBucket('bulkRetire')
  async bulkRetireCredits(
    @Body() dto: BulkRetirementsDto,
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.retirementsService.bulkRetireCredits({
      ...dto,
      retiredBy: req.user.publicKey,
    });

    if ('jobId' in result) {
      res.status(HttpStatus.ACCEPTED);
    }

    return result;
  }

  @Post('bulk/csv')
  @Roles('corporation', 'admin')
  @QuotaBucket('bulkRetire')
  async bulkRetireCreditsFromCsv(
    @Body() dto: CsvBulkRetirementsDto,
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.retirementsService.bulkRetireCreditsFromCsv({
      csv: dto.csv,
      retiredBy: req.user.publicKey,
    });

    if ('jobId' in result || 'status' in result && result.status === 'queued') {
      res.status(HttpStatus.ACCEPTED);
    }

    return result;
  }

  @Get('bulk/csv/:jobId/status')
  @Roles('corporation', 'admin')
  async getBulkCsvStatus(@Param('jobId') jobId: string) {
    return this.retirementsService.getBulkCsvStatus(jobId);
  }

  @Get(':id/certificate-status')
  @Roles('corporation', 'admin')
  async getCertificateStatus(@Param('id') id: string, @Request() req: any) {
    return this.retirementsService.getCertificateStatus(id, req.user.publicKey);
  }

  // Fix IDOR: require auth; only the owner or admin may read a specific retirement
  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: any) {
    const retirement = await this.retirementsService.findOne(id);
    const ability = this.abilityFactory.createForUser(req.user);
    if (ability.cannot('read', subject(RetirementSubject, { retiredBy: retirement.retiredBy }))) {
      throw new ForbiddenException('Access denied');
    }
    return retirement;
  }

  @Get(':id/certificate')
  @Public()
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async getCertificate(@Param('id') id: string) {
    const r = await this.retirementsService.findOne(id);
    const stellarNetwork = process.env.STELLAR_NETWORK === 'public' ? 'public' : 'testnet';
    const verificationUrl = r.txHash
      ? `https://stellar.expert/explorer/${stellarNetwork}/tx/${r.txHash}`
      : null;
    return {
      retirementId: r.retirementId,
      beneficiary: r.beneficiary,
      amount: r.amount.toString(),
      projectName: r.project.name,
      vintageYear: r.vintageYear,
      txHash: r.txHash,
      retiredAt: r.retiredAt,
      retirementReason: r.retirementReason,
      projectId: r.projectId,
      batchId: r.batchId,
      certificateCid: r.certificateCid,
      verificationUrl,
      ipfsUrl: r.certificateCid
        ? `https://gateway.pinata.cloud/ipfs/${r.certificateCid}`
        : null,
    };
  }

  @Post('generate-pdf')
  @Roles('corporation', 'admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('export', RetirementSubject))
  generatePdf(@Body('retirementId') retirementId: string) {
    return this.retirementsService.generatePdf(retirementId);
  }

  // Fix IDOR: scope export to the caller's own retirements
  @Get('export/csv')
  @Roles('corporation', 'admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('export', RetirementSubject))
  async exportCsv(
    @Query() filters: ExportRetirementsDto,
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const scopedFilters = { ...filters, retiredBy: req.user.publicKey };
    const csvBuffer = await this.retirementsService.exportCsv(scopedFilters);
    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="esg-retirements-${new Date().toISOString().split('T')[0]}.csv"`,
      'Content-Length': csvBuffer.length,
    });
    return csvBuffer;
  }

  @Get('export/pdf')
  @Roles('corporation', 'admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('export', RetirementSubject))
  async exportPdf(
    @Query() filters: ExportRetirementsDto,
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const scopedFilters = { ...filters, retiredBy: req.user.publicKey };
    const pdfBuffer = await this.retirementsService.exportPdf(scopedFilters);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="esg-report-${new Date().toISOString().split('T')[0]}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    return pdfBuffer;
  }

  @Post('verify-integrity')
  @Public()
  @HttpCode(200)
  verifyCertificateIntegrity(@Body() dto: VerifyCertificateDto) {
    return this.retirementsService.verifyCertificateIntegrity(dto.retirementId, dto.content);
  }

  /**
   * POST /retirements/verify-signature
   *
   * Verifies a certificate's Ed25519 issuer signature using only the
   * signing public key from Stellar.toml (#594). Public — third parties
   * (regulators, ESG auditors) must be able to verify without auth.
   */
  @Post('verify-signature')
  @Public()
  @HttpCode(200)
  verifyCertificateSignature(@Body() dto: VerifyCertificateSignatureDto) {
    return this.retirementsService.verifyCertificateSignature(dto.certificate);
  }

  /**
   * POST /retirements/:id/zk-proof
   *
   * ABAC condition: only the retirement owner or admin may generate a ZK proof.
   */
  @Post(':id/zk-proof')
  @Roles('corporation', 'admin')
  async createZkProof(@Param('id') id: string, @Request() req: any) {
    const retirement = await this.retirementsService.findOne(id);
    const ability = this.abilityFactory.createForUser(req.user);
    if (ability.cannot('generateProof', subject(ZkProofSubject, { retiredBy: retirement.retiredBy }))) {
      throw new ForbiddenException('Access denied');
    }
    return this.zkProofService.generateProof(id);
  }

  /**
   * GET /retirements/:id/zk-proof
   *
   * ABAC condition: only the retirement owner or admin may read a ZK proof.
   */
  @Get(':id/zk-proof')
  @Roles('corporation', 'admin')
  async getZkProof(@Param('id') id: string, @Request() req: any) {
    const retirement = await this.retirementsService.findOne(id);
    const ability = this.abilityFactory.createForUser(req.user);
    if (ability.cannot('read', subject(ZkProofSubject, { retiredBy: retirement.retiredBy }))) {
      throw new ForbiddenException('Access denied');
    }
    return this.zkProofService.getProof(id);
  }
}
