import { Controller, Get, Post, Param, Body, UseGuards, Header, Res, BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import {
  OracleService,
  OracleServicesHealth,
  SubmitMonitoringDto,
  UpdatePriceDto,
  FlagProjectDto,
  HoldPriceUpdateDto,
  BatchSubmitMonitoringDto,
  BatchUpdatePriceDto,
} from './oracle.service';
import { OracleSyncService } from './oracle-sync.service';
import { OracleSchedulerService } from './oracle-scheduler.service';
import { OracleGuard } from './oracle.guard';
import { Public, Roles } from '../auth/decorators';
import { CheckPolicies, PoliciesGuard, OracleDataSubject } from '../policies';

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
   * Returns the aggregate health of all three oracle services.
   * Public — no authentication required.
   * Response is cached for 30 seconds via Cache-Control.
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
  // The OracleGuard verifies an Ed25519 Stellar keypair signature.
  // @Public() bypasses RolesGuard (no JWT); @UseGuards(OracleGuard) enforces oracle auth.

  @Post('ingest/monitoring')
  @Public()
  @UseGuards(OracleGuard)
  submitMonitoring(@Body() dto: SubmitMonitoringDto) {
    return this.oracleService.submitMonitoring(dto);
  }

  @Post('ingest/batch-monitoring')
  @Public()
  @UseGuards(OracleGuard)
  submitBatchMonitoring(@Body() body: BatchSubmitMonitoringDto | SubmitMonitoringDto[]) {
    const items = Array.isArray(body) ? body : body?.items;
    if (!items || !Array.isArray(items)) {
      throw new BadRequestException('Request body must be an array of SubmitMonitoringDto or contain an items array');
    }
    return this.oracleService.submitBatchMonitoring(items);
  }

  @Post('ingest/price')
  @Public()
  @UseGuards(OracleGuard)
  updatePrice(@Body() dto: UpdatePriceDto) {
    return this.oracleService.submitPrice(dto);
  }

  @Post('ingest/batch-price')
  @Public()
  @UseGuards(OracleGuard)
  updateBatchPrice(@Body() body: BatchUpdatePriceDto | UpdatePriceDto[]) {
    const items = Array.isArray(body) ? body : body?.items;
    if (!items || !Array.isArray(items)) {
      throw new BadRequestException('Request body must be an array of UpdatePriceDto or contain an items array');
    }
    return this.oracleService.submitBatchPrice(items);
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
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('hold', OracleDataSubject))
  holdPriceUpdate(@Body() dto: HoldPriceUpdateDto) {
    return this.oracleService.holdPriceUpdate(dto);
  }

  @Get('price-approvals')
  @Roles('admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('read', OracleDataSubject))
  getPriceApprovals() {
    return this.oracleService.getPriceApprovals();
  }

  @Post('price-approvals/:id/approve')
  @Roles('admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('approve', OracleDataSubject))
  approvePriceUpdate(@Param('id') id: string) {
    return this.oracleService.approvePriceUpdate(id);
  }

  @Post('price-approvals/:id/reject')
  @Roles('admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('reject', OracleDataSubject))
  rejectPriceUpdate(@Param('id') id: string, @Body('reason') reason?: string) {
    return this.oracleService.rejectPriceUpdate(id, reason);
  }
}
