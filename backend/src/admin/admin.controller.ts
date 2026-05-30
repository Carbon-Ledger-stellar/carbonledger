import {
  Controller, Get, Post, Delete, Body, Param, Query,
  UseGuards, Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AdminService } from './admin.service';
import { VerifierWhitelistDto, UpdateTreasuryDto } from './admin.dto';

@Controller('admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // ── Verifier whitelist ──────────────────────────────────────────────────────

  @Get('verifiers')
  listVerifiers() {
    return this.admin.listVerifiers();
  }

  @Post('verifiers')
  addVerifier(@Body() dto: VerifierWhitelistDto) {
    return this.admin.addVerifier(dto.address);
  }

  @Delete('verifiers/:address')
  removeVerifier(@Param('address') address: string) {
    return this.admin.removeVerifier(address);
  }

  // ── Treasury ────────────────────────────────────────────────────────────────

  @Get('treasury')
  getTreasury() {
    return this.admin.getTreasury();
  }

  @Post('treasury')
  updateTreasury(@Body() dto: UpdateTreasuryDto) {
    return this.admin.updateTreasury(dto.address);
  }

  // ── Oracle health ───────────────────────────────────────────────────────────

  @Get('oracle/health')
  oracleHealth() {
    return this.admin.getOracleHealth();
  }

  // ── Re-index ────────────────────────────────────────────────────────────────

  @Post('reindex')
  reindex() {
    return this.admin.triggerReindex();
  }

  // ── Audit log ───────────────────────────────────────────────────────────────

  @Get('audit-logs')
  auditLogs(
    @Query('limit')  limit?: number,
    @Query('offset') offset?: number,
    @Query('action') action?: string,
  ) {
    return this.admin.getAuditLogs({ limit, offset, action });
  }
}
