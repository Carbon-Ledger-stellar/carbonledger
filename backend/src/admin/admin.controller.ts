import {
  Controller, Get, Post, Delete, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { AdminService } from './admin.service';
import { VerifierWhitelistDto, UpdateTreasuryDto, AssignRoleDto, UpdateCanaryDto } from './admin.dto';
import { CheckPolicies, PoliciesGuard, UserSubject, AuditLogSubject } from '../policies';

/**
 * AdminController — all routes require role=admin.
 *
 * The global RolesGuard (APP_GUARD) enforces the JWT check and role restriction.
 * PoliciesGuard adds fine-grained ABAC per-action validation on top.
 */
@Controller('admin')
@Roles('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // ── Role assignment ─────────────────────────────────────────────────────────

  @Post('users/:publicKey/role')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('assignRole', UserSubject))
  assignRole(@Param('publicKey') publicKey: string, @Body() dto: AssignRoleDto) {
    return this.admin.assignRole(publicKey, dto.role);
  }

  // ── Verifier whitelist ──────────────────────────────────────────────────────

  @Get('verifiers')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('read', UserSubject))
  listVerifiers() {
    return this.admin.listVerifiers();
  }

  @Post('verifiers')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('create', UserSubject))
  addVerifier(@Body() dto: VerifierWhitelistDto) {
    return this.admin.addVerifier(dto.address);
  }

  @Delete('verifiers/:address')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('delete', UserSubject))
  removeVerifier(@Param('address') address: string) {
    return this.admin.removeVerifier(address);
  }

  // ── Treasury ────────────────────────────────────────────────────────────────

  @Get('treasury')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('read', 'all'))
  getTreasury() {
    return this.admin.getTreasury();
  }

  @Post('treasury')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('update', 'all'))
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
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('reindex', 'all'))
  reindex() {
    return this.admin.triggerReindex();
  }

  // ── Audit log ───────────────────────────────────────────────────────────────

  @Get('audit-logs')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('read', AuditLogSubject))
  auditLogs(
    @Query('limit')  limit?: number,
    @Query('offset') offset?: number,
    @Query('action') action?: string,
  ) {
    return this.admin.getAuditLogs({ limit, offset, action });
  }

  @Get('abuse-log')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('read', AuditLogSubject))
  getAbuseLog() {
    return this.admin.getAbuseLog();
  }
}
