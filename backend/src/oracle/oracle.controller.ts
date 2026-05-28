import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import {
  OracleService,
  SubmitMonitoringDto,
  UpdatePriceDto,
  FlagProjectDto,
  HoldPriceUpdateDto,
} from './oracle.service';
import { OracleGuard } from './oracle.guard';
import { Public, Roles } from '../auth/decorators';

@Controller('oracle')
export class OracleController {
  constructor(private readonly oracleService: OracleService) {}

  // ── Public status read ───────────────────────────────────────────────────

  @Get('status/:projectId')
  @Public()
  getStatus(@Param('projectId') projectId: string) {
    return this.oracleService.getStatus(projectId);
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
