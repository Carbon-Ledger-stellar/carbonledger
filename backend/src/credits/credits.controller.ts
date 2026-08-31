import { Controller, Get, Post, Param, Query, Body, Request, UseGuards, BadRequestException, Res } from '@nestjs/common';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { CreditsService } from './credits.service';
import { MintCreditsDto, RetireCreditsDto, BatchMintCreditsDto, BatchRetireCreditsDto } from './credits.dto';
import { Public, Roles } from '../auth/decorators';
import { CheckPolicies, PoliciesGuard, CreditBatchSubject, RetirementSubject } from '../policies';

@Controller('credits')
export class CreditsController {
  constructor(private readonly creditsService: CreditsService) {}

  // ── Public read endpoints ────────────────────────────────────────────────

  @Get('project/:projectId/batches')
  @Public()
  getBatchesByProject(@Param('projectId') projectId: string) {
    return this.creditsService.getBatchesByProject(projectId);
  }

  @Get('batch/:id')
  @Public()
  getBatch(@Param('id') id: string) {
    return this.creditsService.getBatch(id);
  }

  @Get('retirement/:id')
  @Public()
  getRetirement(@Param('id') id: string) {
    return this.creditsService.getRetirement(id);
  }

  /**
   * GET /credits/search?serial=VCS-123
   *
   * Full-text serial number search. Supports partial match — "VCS" returns
   * all credits whose batchId or projectId contains "VCS".
   *
   * Uses indexed serialStart / serialEnd / batchId columns for fast lookup
   * on datasets of 100k+ records.
   *
   * Public — no authentication required.
   */
  @Get('search')
  @Public()
  search(@Query('serial') serial: string) {
    return this.creditsService.searchBySerial(serial);
  }

  /**
   * GET /credits/:id/certificate
   *
   * Returns the retirement certificate for the given retirementId.
   *
   * - If the PDF has already been generated, it is streamed directly to the
   *   caller with Content-Type: application/pdf and a 30-day cache header.
   * - If the PDF has not yet been generated, it is created on demand and the
   *   same response is returned.
   * - If the PDF service is unavailable, a JSON response containing the
   *   permanent certificate URL is returned instead.
   *
   * Public — no authentication required.
   * Returns 404 when the retirement record is not found.
   */
  @Get(':id/certificate')
  @Public()
  async getCertificate(@Param('id') id: string, @Res() res: Response) {
    const result = await this.creditsService.getCertificate(id);
    if (result.pdfBuffer) {
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="certificate-${id}.pdf"`,
        'Cache-Control': 'public, max-age=2592000', // 30 days
      });
      res.send(result.pdfBuffer);
    } else {
      res.json({ certificate_url: result.certificateUrl, retirementId: id });
    }
  }

  @Get('lookup/:serial')
  @Public()
  lookup(@Param('serial') serial: string) {
    return this.creditsService.lookupSerial(serial);
  }

  /**
   * GET /credits/provenance/:serial
   *
   * Returns full provenance for a single credit serial number:
   *   - minting batch details (project name, vintage year)
   *   - all transfer events in chronological order
   *   - current owner
   *   - retirement details if retired
   *
   * Public — no authentication required.
   * Returns 404 when the serial number is unknown.
   */
  @Get('provenance/:serial')
  @Public()
  getProvenance(@Param('serial') serial: string) {
    return this.creditsService.getSerialProvenance(serial);
  }

  // ── Admin: mint credits for verified projects ────────────────────────────

  @Post('mint')
  @Roles('admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('mint', CreditBatchSubject))
  mint(@Body() dto: MintCreditsDto) {
    return this.creditsService.mintCredits(dto);
  }

  @Post('batch-mint')
  @Roles('admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('mint', CreditBatchSubject))
  batchMint(@Body() body: BatchMintCreditsDto | MintCreditsDto[], @Request() req: any) {
    const items = Array.isArray(body) ? body : body?.items;
    if (!items || !Array.isArray(items)) {
      throw new BadRequestException('Request body must be an array of MintCreditsDto or contain an items array');
    }
    return this.creditsService.batchMintCredits(items, req.user?.publicKey);
  }

  // ── Corporation: retire credits ──────────────────────────────────────────

  @Post('retire')
  @Roles('corporation', 'admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('retire', RetirementSubject))
  @Throttle({ retire: { ttl: 60_000, limit: 10 } })
  retire(@Body() dto: RetireCreditsDto, @Request() req: any) {
    // Derive retiredBy from the authenticated JWT — prevents mass assignment
    const authedDto = { ...dto, holderPublicKey: req.user.publicKey };
    return this.creditsService.retireCredits(authedDto);
  }

  @Post('batch-retire')
  @Roles('corporation', 'admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('retire', RetirementSubject))
  @Throttle({ retire: { ttl: 60_000, limit: 10 } })
  batchRetire(@Body() body: BatchRetireCreditsDto | RetireCreditsDto[], @Request() req: any) {
    return this.processBulkRetire(body, req);
  }

  /**
   * POST /credits/bulk-retire (#965)
   *
   * Alias of batch-retire under the endpoint name requested by the issue.
   * Retires up to 1,000 credit batches in a single atomic transaction —
   * either every item succeeds or none are written. See
   * CreditsService#batchRetireCredits for the per-item error reporting and
   * size-limit enforcement.
   */
  @Post('bulk-retire')
  @Roles('corporation', 'admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('retire', RetirementSubject))
  @Throttle({ retire: { ttl: 60_000, limit: 10 } })
  bulkRetire(@Body() body: BatchRetireCreditsDto | RetireCreditsDto[], @Request() req: any) {
    return this.processBulkRetire(body, req);
  }

  private processBulkRetire(body: BatchRetireCreditsDto | RetireCreditsDto[], req: any) {
    const rawItems = Array.isArray(body) ? body : body?.items;
    if (!rawItems || !Array.isArray(rawItems)) {
      throw new BadRequestException('Request body must be an array of RetireCreditsDto or contain an items array');
    }
    const authedItems = rawItems.map((dto) => ({
      ...dto,
      holderPublicKey: req.user.publicKey,
    }));
    return this.creditsService.batchRetireCredits(authedItems);
  }
}

