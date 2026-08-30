import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuditService } from './audit.service';
import { Roles } from '../auth/decorators';
import { CheckPolicies, PoliciesGuard, AuditLogSubject } from '../policies';

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * GET /audit
   * Cursor-based pagination over the audit log with date/user/action filtering.
   *
   * Query params:
   *   cursor     — opaque cursor from previous response's next_cursor
   *   limit      — page size (1-100, default 50)
   *   userId     — filter by user ID
   *   action     — filter by action string (prefix/exact)
   *   startDate  — ISO 8601 date filter (inclusive lower bound)
   *   endDate    — ISO 8601 date filter (inclusive upper bound)
   *   offset     — legacy offset fallback (ignored when cursor present)
   *
   * Returns: { logs, next_cursor, prev_cursor, total_count }
   */
  @Get()
  @Roles('admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('read', AuditLogSubject))
  getLogs(
    @Query('cursor')    cursor?:    string,
    @Query('limit')     limit?:     string,
    @Query('userId')    userId?:    string,
    @Query('action')    action?:    string,
    @Query('offset')    offset?:    string,
    @Query('startDate') startDate?: string,
    @Query('endDate')   endDate?:   string,
  ) {
    const parsedLimit = limit ? Number(limit) : 50;
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new BadRequestException('limit must be a number between 1 and 100');
    }

    // Validate date params when provided
    if (startDate && isNaN(Date.parse(startDate))) {
      throw new BadRequestException('startDate must be a valid ISO 8601 date');
    }
    if (endDate && isNaN(Date.parse(endDate))) {
      throw new BadRequestException('endDate must be a valid ISO 8601 date');
    }

    // Decode opaque cursor — base64-encoded JSON { id: string }
    let decodedCursor: { id: string } | undefined;
    if (cursor) {
      try {
        const raw    = Buffer.from(cursor, 'base64').toString('utf8');
        const parsed = JSON.parse(raw);
        if (typeof parsed.id !== 'string') throw new Error('missing id');
        decodedCursor = { id: parsed.id };
      } catch {
        throw new BadRequestException('Invalid cursor');
      }
    }

    return this.auditService.findAllCursor({
      cursor:    decodedCursor,
      limit:     parsedLimit,
      userId,
      action,
      offset:    offset ? Number(offset) : undefined,
      startDate,
      endDate,
    });
  }

  /**
   * GET /audit/verify
   * Walks the entire AuditLog chain and confirms every SHA-256 hash link is
   * intact. A broken link means a row was inserted, deleted, or modified.
   * Admin-only.
   */
  @Get('verify')
  @Roles('admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('read', AuditLogSubject))
  verifyChain() {
    return this.auditService.verifyChain();
  }

  /**
   * GET /audit/report/monthly?year=2025&month=8
   *
   * Generates a monthly audit report for compliance purposes (#1080).
   * Returns aggregate counts by action and user, plus detailed admin-action list.
   * Admin-only.
   */
  @Get('report/monthly')
  @Roles('admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('read', AuditLogSubject))
  getMonthlyReport(
    @Query('year')  yearStr?:  string,
    @Query('month') monthStr?: string,
  ) {
    const now = new Date();
    const year  = yearStr  ? Number(yearStr)  : now.getFullYear();
    const month = monthStr ? Number(monthStr) : now.getMonth() + 1;

    if (isNaN(year) || year < 2020 || year > now.getFullYear() + 1) {
      throw new BadRequestException('year must be a valid calendar year');
    }
    if (isNaN(month) || month < 1 || month > 12) {
      throw new BadRequestException('month must be between 1 and 12');
    }

    return this.auditService.getMonthlyReport(year, month);
  }

  /**
   * GET /audit/retention/check
   *
   * Returns a retention policy status report (#1080).
   * Shows how many records are within / beyond the 7-year retention window.
   * Admin-only.
   */
  @Get('retention/check')
  @Roles('admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('read', AuditLogSubject))
  checkRetentionPolicy() {
    return this.auditService.checkRetentionPolicy();
  }
}
