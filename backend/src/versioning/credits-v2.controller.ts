import { Controller, Get, Post, Param, Body, Request, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CreditsService } from '../credits/credits.service';
import { MintCreditsDto, RetireCreditsDto } from '../credits/credits.dto';
import { Public, Roles } from '../auth/decorators';

/**
 * Credits controller for API v2.
 *
 * Changes from v1 → v2:
 *  - GET /credits/batch/:id  → enhanced response includes `provenanceUrl` field
 *  - GET /credits/lookup/:serial  → returns full provenance by default
 *  - GET /credits/stats  → NEW endpoint returning aggregate credit statistics
 *
 * Backward-compatible changes (shared service layer with v1):
 *  - POST /credits/mint  — identical
 *  - POST /credits/retire  — identical
 */
@Controller({ path: 'credits', version: '2' })
export class CreditsV2Controller {
  constructor(private readonly creditsService: CreditsService) {}

  // ── Public read endpoints ────────────────────────────────────────────────

  /**
   * v2 enhancement: response includes a `provenanceUrl` for self-serve audit.
   */
  @Get('batch/:id')
  @Public()
  async getBatch(@Param('id') id: string, @Request() req: any) {
    const batch = await this.creditsService.getBatch(id);
    return {
      ...batch,
      provenanceUrl: `${req.protocol}://${req.get('host')}/api/v2/credits/provenance/${batch?.serialStart}`,
      _version: 2,
    };
  }

  @Get('retirement/:id')
  @Public()
  getRetirement(@Param('id') id: string) {
    return this.creditsService.getRetirement(id);
  }

  /**
   * v2 enhancement: lookup returns full provenance by default (was separate endpoint in v1).
   */
  @Get('lookup/:serial')
  @Public()
  async lookup(@Param('serial') serial: string, @Request() req: any) {
    const [credit, provenance] = await Promise.all([
      this.creditsService.lookupSerial(serial),
      this.creditsService.getSerialProvenance(serial).catch(() => null),
    ]);
    return {
      ...credit,
      provenance,
      _version: 2,
    };
  }

  @Get('provenance/:serial')
  @Public()
  getProvenance(@Param('serial') serial: string) {
    return this.creditsService.getSerialProvenance(serial);
  }

  // ── Admin: mint credits for verified projects ────────────────────────────

  @Post('mint')
  @Roles('admin')
  mint(@Body() dto: MintCreditsDto) {
    return this.creditsService.mintCredits(dto);
  }

  // ── Corporation: retire credits ──────────────────────────────────────────

  @Post('retire')
  @Roles('corporation', 'admin')
  @Throttle({ retire: { ttl: 60_000, limit: 10 } })
  retire(@Body() dto: RetireCreditsDto, @Request() req: any) {
    const authedDto = { ...dto, holderPublicKey: req.user.publicKey };
    return this.creditsService.retireCredits(authedDto);
  }
}
