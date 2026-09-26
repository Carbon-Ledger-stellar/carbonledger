import {
  Controller, Get, Post, Delete, Body, Param, Query, Req,
  UseGuards, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../auth/decorators';
import { AdminService } from './admin.service';
import { PauseService, PAUSABLE_CONTRACTS, type PausableContract } from './pause.service';
import {
  VerifierWhitelistDto, UpdateTreasuryDto, AssignRoleDto, UpdateCanaryDto,
  ReviewQuarantineDto, SoftDeleteDto, PauseContractDto,
} from './admin.dto';
import {
  CheckPolicies, PoliciesGuard, UserSubject, AuditLogSubject, OracleDataSubject,
  ProjectSubject, CreditBatchSubject, RetirementSubject,
} from '../policies';

/**
 * AdminController — all routes require role=admin.
 *
 * The global RolesGuard (APP_GUARD) enforces the JWT check and role restriction.
 * PoliciesGuard adds fine-grained ABAC per-action validation on top.
 */
@Controller('admin')
@Roles('admin')
@ApiBearerAuth()
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly pause: PauseService,
  ) {}

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

  // ── Emergency pause (#1307) ─────────────────────────────────────────────────
  //
  // Traced end to end (contract call → DB update → event emit); the response
  // carries the traceId for lookup in Jaeger.

  @Get('contracts/:contract/pause')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('read', 'all'))
  getPauseState(@Param('contract') contract: string) {
    return this.pause.getPauseState(parsePausableContract(contract));
  }

  @Post('contracts/:contract/pause')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('update', 'all'))
  pauseContract(@Param('contract') contract: string, @Body() dto: PauseContractDto, @Req() req: any) {
    return this.pause.pauseContract(parsePausableContract(contract), req.user?.publicKey, dto.untilTimestamp);
  }

  @Post('contracts/:contract/unpause')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('update', 'all'))
  unpauseContract(@Param('contract') contract: string, @Req() req: any) {
    return this.pause.unpauseContract(parsePausableContract(contract), req.user?.publicKey);
  }

  // ── Soft delete / recovery (#964) ───────────────────────────────────────────
  //
  // Delete + restore for the three retention-tracked resources. Reads
  // everywhere else (project list, credit batch lookup, retirement search,
  // ...) already exclude deletedAt rows by default — these are the only
  // routes that can see or touch a soft-deleted row before the retention
  // job purges it (30 days, see purgeDeletedRecords below).

  @Delete('projects/:projectId')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('delete', ProjectSubject))
  softDeleteProject(@Param('projectId') projectId: string, @Body() dto: SoftDeleteDto, @Req() req: any) {
    return this.admin.softDeleteProject(projectId, req.user?.publicKey, dto.reason);
  }

  @Post('projects/:projectId/restore')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('update', ProjectSubject))
  restoreProject(@Param('projectId') projectId: string, @Req() req: any) {
    return this.admin.restoreProject(projectId, req.user?.publicKey);
  }

  @Delete('credits/:batchId')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('delete', CreditBatchSubject))
  softDeleteCreditBatch(@Param('batchId') batchId: string, @Body() dto: SoftDeleteDto, @Req() req: any) {
    return this.admin.softDeleteCreditBatch(batchId, req.user?.publicKey, dto.reason);
  }

  @Post('credits/:batchId/restore')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('update', CreditBatchSubject))
  restoreCreditBatch(@Param('batchId') batchId: string, @Req() req: any) {
    return this.admin.restoreCreditBatch(batchId, req.user?.publicKey);
  }

  @Delete('retirements/:retirementId')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('delete', RetirementSubject))
  softDeleteRetirement(@Param('retirementId') retirementId: string, @Body() dto: SoftDeleteDto, @Req() req: any) {
    return this.admin.softDeleteRetirement(retirementId, req.user?.publicKey, dto.reason);
  }

  @Post('retirements/:retirementId/restore')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('update', RetirementSubject))
  restoreRetirement(@Param('retirementId') retirementId: string, @Req() req: any) {
    return this.admin.restoreRetirement(retirementId, req.user?.publicKey);
  }

  // ── Purge Deleted ───────────────────────────────────────────────────────────

  @Delete('purge')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('delete', 'all'))
  purgeDeletedRecords() {
    return this.admin.purgeDeletedRecords();
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

  // ── Satellite quarantine queue (#579) ───────────────────────────────────────
  //
  // Satellite submissions whose sequestration claim is statistically
  // implausible are held by the oracle for manual review rather than discarded.
  // These routes are the review surface for that queue.

  @Get('satellite/quarantine')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('read', OracleDataSubject))
  listQuarantine(
    @Query('status') status?: string,
    @Query('limit')  limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.admin.listQuarantine({ status, limit, offset });
  }

  @Get('satellite/quarantine/depth')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('read', OracleDataSubject))
  quarantineDepth() {
    return this.admin.getQuarantineDepth();
  }

  @Get('satellite/quarantine/:id')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('read', OracleDataSubject))
  getQuarantineEntry(@Param('id') id: string) {
    return this.admin.getQuarantineEntry(id);
  }

  @Post('satellite/quarantine/:id/review')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('update', OracleDataSubject))
  reviewQuarantine(
    @Param('id') id: string,
    @Body() dto: ReviewQuarantineDto,
    @Req() req: any,
  ) {
    return this.admin.reviewQuarantineEntry(
      id,
      dto.decision,
      req.user?.publicKey,
      dto.note,
    );
  }
}

function parsePausableContract(contract: string): PausableContract {
  if (!(PAUSABLE_CONTRACTS as readonly string[]).includes(contract)) {
    throw new BadRequestException(`contract must be one of: ${PAUSABLE_CONTRACTS.join(', ')}`);
  }
  return contract as PausableContract;
}
