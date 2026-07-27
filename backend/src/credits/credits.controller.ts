import { Controller, Get, Post, Param, Body, Request } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CreditsService } from './credits.service';
import { MintCreditsDto, RetireCreditsDto } from './credits.dto';
import { Public, Roles } from '../auth/decorators';

@Controller('credits')
export class CreditsController {
  constructor(private readonly creditsService: CreditsService) {}

  // ── Public read endpoints ────────────────────────────────────────────────

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
  mint(@Body() dto: MintCreditsDto) {
    return this.creditsService.mintCredits(dto);
  }

  // ── Corporation: retire credits ──────────────────────────────────────────

  @Post('retire')
  @Roles('corporation', 'admin')
  @Throttle({ retire: { ttl: 60_000, limit: 10 } })
  retire(@Body() dto: RetireCreditsDto, @Request() req: any) {
    // Fix mass assignment: derive retiredBy from the authenticated JWT, not the body
    const authedDto = { ...dto, holderPublicKey: req.user.publicKey };
    return this.creditsService.retireCredits(authedDto);
  }
}
