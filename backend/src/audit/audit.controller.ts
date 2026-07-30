import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { Roles } from '../auth/decorators';
import { CheckPolicies, PoliciesGuard, AuditLogSubject } from '../policies';

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles('admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('read', AuditLogSubject))
  getLogs(
    @Query('limit')  limit?: number,
    @Query('offset') offset?: number,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.auditService.findAll({ limit, offset, userId, action, cursor });
  }

  /**
   * GET /audit/verify
   *
   * Walks the entire AuditLog chain and confirms every SHA-256 hash link is
   * intact.  A broken link means a row was inserted, deleted, or modified.
   * Admin-only.
   */
  @Get('verify')
  @Roles('admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('read', AuditLogSubject))
  verifyChain() {
    return this.auditService.verifyChain();
  }
}
