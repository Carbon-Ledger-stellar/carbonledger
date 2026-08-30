import {
  Controller, Get, Post, Delete, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators';
import { AdminService } from './admin.service';
import { VerifierWhitelistDto, UpdateTreasuryDto, AssignRoleDto, UpdateCanaryDto } from './admin.dto';

@ApiTags('Admin')
@Controller('admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
@ApiBearerAuth()
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

  @Get('abuse-log')
  getAbuseLog() {
    return this.admin.getAbuseLog();
  }

  // ── Queue / Dead Letter Queue ────────────────────────────────────────────────

  /**
   * GET /api/admin/queue/dlq
   * List all jobs in the Dead Letter Queue.
   */
  @Get('queue/dlq')
  @ApiOperation({ summary: 'List all Dead Letter Queue entries' })
  @ApiQuery({ name: 'jobType', required: false })
  @ApiQuery({ name: 'requeued', required: false, type: Boolean })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'DLQ entries matching the query' })
  listDlq(
    @Query('jobType') jobType?: string,
    @Query('requeued') requeued?: string,
    @Query('limit')  limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.admin.listDeadLetterJobs({
      jobType,
      requeued: requeued !== undefined ? requeued === 'true' : undefined,
      limit,
      offset,
    });
  }

  /**
   * GET /api/admin/queue/dlq/stats
   * Return count of pending DLQ entries.
   */
  @Get('queue/dlq/stats')
  @ApiOperation({ summary: 'Count of pending DLQ entries' })
  @ApiResponse({ status: 200, description: '{ pendingDlqJobs: number }' })
  dlqStats() {
    return this.admin.getDlqStats();
  }

  /**
   * POST /api/admin/queue/retry-failed
   * Requeue all pending DLQ entries (optionally filter by jobType).
   *
   * This is the primary endpoint called by operators after a prolonged
   * Stellar network outage — it re-submits every dead-lettered job with
   * fresh retry settings so no transactions are permanently lost.
   */
  @Post('queue/retry-failed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Requeue all pending Dead Letter Queue jobs' })
  @ApiQuery({ name: 'jobType', required: false, description: 'Filter by job type (e.g. oracle_submission)' })
  @ApiResponse({ status: 200, description: '{ requeued: number, errors: string[] }' })
  retryAllFailed(@Query('jobType') jobType?: string) {
    return this.admin.requeueAllFailedJobs(jobType);
  }

  /**
   * POST /api/admin/queue/dlq/:id/retry
   * Requeue a single DLQ entry by its database record ID.
   */
  @Post('queue/dlq/:id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Requeue a single DLQ entry by record ID' })
  @ApiParam({ name: 'id', description: 'DLQ record ID (cuid)' })
  @ApiResponse({ status: 200, description: '{ newJobId: string, dlqId: string }' })
  retryOne(@Param('id') id: string) {
    return this.admin.requeueDeadLetterJob(id);
  }

  // ── Canary ────────────────────────────────────────────────────────────────

  @Post('canary')
  updateCanary(@Body() dto: UpdateCanaryDto) {
    return this.admin.updateCanary(dto);
  }

  @Get('canary')
  getCanaryStatus() {
    return this.admin.getCanaryStatus();
  }
}
