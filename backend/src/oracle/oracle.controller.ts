import { Controller, Get, Post, Param, Body, UseGuards, Header, Res } from '@nestjs/common';
import { Response } from 'express';
import {
  OracleService,
  OracleServicesHealth,
  SubmitMonitoringDto,
  UpdatePriceDto,
  FlagProjectDto,
  HoldPriceUpdateDto,
} from './oracle.service';
import { OracleGuard } from './oracle.guard';
import { Public, Roles } from '../auth/decorators';

/** Cache TTL for the services health endpoint (30 seconds). */
const HEALTH_CACHE_TTL_S = 30;

@Controller('oracle')
export class OracleController {
  constructor(
    private readonly oracleService: OracleService,
    private readonly oracleSyncService: OracleSyncService,
    private readonly oracleSchedulerService: OracleSchedulerService
  ) {}

  // ── Public status read ───────────────────────────────────────────────────

  @Get('status/:projectId')
  @Public()
  getStatus(@Param('projectId') projectId: string) {
    return this.oracleService.getStatus(projectId);
  }

  /**
   * GET /oracle/services/health
   *
   * Returns the aggregate health of all three oracle services:
   *   - verification_listener  (stale threshold: 365 days)
   *   - price_oracle           (stale threshold: 24 hours)
   *   - satellite_monitor      (stale threshold: 365 days)
   *
   * Always returns HTTP 200.  The `status` field per service is one of:
   *   "healthy" | "stale" | "offline"
   *
   * Response is cached for 30 seconds via Cache-Control.
   * Public — no authentication required.
   */
  @Get('services/health')
  @Public()
  async getServicesHealth(@Res() res: Response): Promise<void> {
    const health: OracleServicesHealth = await this.oracleService.getServicesHealth();

    res
      .set('Cache-Control', `public, max-age=${HEALTH_CACHE_TTL_S}, s-maxage=${HEALTH_CACHE_TTL_S}`)
      .status(200)
      .json(health);
  }

  // ── Internal oracle endpoints — authenticated with oracle keypair ─────────

  @Post('ingest/monitoring')
  @Public()                   // bypass JWT RolesGuard
  @UseGuards(OracleGuard)     // oracle keypair signature required
  submitMonitoring(@Body() dto: SubmitMonitoringDto) {
    return this.oracleService.submitMonitoring(dto);
  }

  @Post('ingest/price')
  @Public()
  @UseGuards(OracleGuard)
  updatePrice(@Body() dto: UpdatePriceDto) {
    return this.oracleService.submitPrice(dto);
  }

  @Post('ingest/flag')
  @Public()
  @UseGuards(OracleGuard)
  flagProject(@Body() dto: FlagProjectDto) {
    return this.oracleService.flagProject(dto);
  }

  // ── Admin: price approval workflow ───────────────────────────────────────

  @Post('price-approvals/hold')
  @Roles('admin')
  holdPriceUpdate(@Body() dto: HoldPriceUpdateDto) {
    return this.oracleService.holdPriceUpdate(dto);
  }

  @Get('price-approvals')
  @Roles('admin')
  getPriceApprovals() {
    return this.oracleService.getPriceApprovals();
  }

  @Post('price-approvals/:id/approve')
  @Roles('admin')
  approvePriceUpdate(@Param('id') id: string) {
    return this.oracleService.approvePriceUpdate(id);
  }

  @Post('price-approvals/:id/reject')
  @Roles('admin')
  rejectPriceUpdate(@Param('id') id: string, @Body('reason') reason?: string) {
    return this.oracleService.rejectPriceUpdate(id, reason);
  }
}
