import {
  Controller, Get, Post, Delete, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators';
import { AdminService } from './admin.service';
import { VerifierWhitelistDto, UpdateTreasuryDto, AssignRoleDto, UpdateCanaryDto } from './admin.dto';

@Controller('admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // ── Role assignment ─────────────────────────────────────────────────────────

  @Post('users/:publicKey/role')
  assignRole(@Param('publicKey') publicKey: string, @Body() dto: AssignRoleDto) {
    return this.admin.assignRole(publicKey, dto.role);
  }

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

  // ── Canary deployment ───────────────────────────────────────────────────────

  /**
   * GET /api/v1/admin/canary
   *
   * Returns the current canary routing configuration and live error rates for
   * both the primary and canary contract targets.
   */
  @Get('canary')
  getCanary() {
    return this.admin.getCanaryStatus();
  }

  /**
   * POST /api/v1/admin/canary
   *
   * Adjust the canary traffic split or contract address at runtime.
   *
   * Body:
   *   { "trafficPct": 10 }         — route 10% of calls to canary
   *   { "trafficPct": 0 }          — disable canary (rollback)
   *   { "canaryContractId": "C..." } — set/change the canary contract
   *
   * This endpoint is also called by the Grafana alert webhook for automated
   * rollback: POST { "trafficPct": 0 } when canary_error_rate > threshold.
   */
  @Post('canary')
  @HttpCode(HttpStatus.OK)
  updateCanary(@Body() dto: UpdateCanaryDto) {
    return this.admin.updateCanary({
      canaryContractId: dto.canaryContractId,
      trafficPct:       dto.trafficPct,
    });
  }
}
