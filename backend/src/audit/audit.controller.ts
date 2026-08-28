import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditArchiveService } from './audit-archive.service';
import { Roles } from '../auth/decorators';
import { CheckPolicies, PoliciesGuard, AuditLogSubject } from '../policies';

@Controller('audit')
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly auditArchiveService: AuditArchiveService,
  ) {}

  /**
   * GET /audit
   * Cursor-based pagination over the audit log (issue #598).
   *
   * Accepts:
   *   ?cursor=<base64>  opaque cursor from previous response's next_cursor
   *   ?limit=<1-100>    page size (default 50, max 100)
   *   ?userId=<id>      filter by user
   *   ?action=<str>     filter by action
   *   ?offset=<n>       legacy offset fallback (ignored when cursor is present)
   *
   * Returns:
   *   { logs, next_cursor, prev_cursor, total_count }
   */
  @Get()
  @Roles('admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('read', AuditLogSubject))
  getLogs(
    @Query('cursor')  cursor?: string,
    @Query('limit')   limit?: string,
    @Query('userId')  userId?: string,
    @Query('action')  action?: string,
    @Query('offset')  offset?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : 50;
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new BadRequestException('limit must be a number between 1 and 100');
    }

    // Decode opaque cursor — base64-encoded JSON { id: string }
    let decodedCursor: { id: string } | undefined;
    if (cursor) {
      try {
        const raw = Buffer.from(cursor, 'base64').toString('utf8');
        const parsed = JSON.parse(raw);
        if (typeof parsed.id !== 'string') throw new Error('missing id');
        decodedCursor = { id: parsed.id };
      } catch {
        throw new BadRequestException('Invalid cursor');
      }
    }

    return this.auditService.findAllCursor({
      cursor: decodedCursor,
      limit:  parsedLimit,
      userId,
      action,
      offset: offset ? Number(offset) : undefined,
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
   * GET /audit/archived
   * Retrieves compressed audit log entries that have been archived from the
   * hot AuditLog table (entries older than 6 months). Each row is
   * decompressed on the fly; the full entry — including previousHash and
   * entryHash — is returned so callers can verify the hash chain.
   *
   * Query params:
   *   ?limit=<1-100>   page size (default 50, max 100)
   *   ?offset=<n>      skip n rows (default 0)
   *   ?userId=<id>     filter by user
   *   ?action=<str>    filter by action
   *
   * Returns:
   *   { entries: ArchivedLogEntry[], total_count: number }
   */
  @Get('archived')
  @Roles('admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('read', AuditLogSubject))
  getArchivedLogs(
    @Query('limit')   limit?: string,
    @Query('offset')  offset?: string,
    @Query('userId')  userId?: string,
    @Query('action')  action?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : 50;
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new BadRequestException('limit must be a number between 1 and 100');
    }

    const parsedOffset = offset ? Number(offset) : 0;
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      throw new BadRequestException('offset must be a non-negative number');
    }

    return this.auditArchiveService.getArchivedLogs({
      limit: parsedLimit,
      offset: parsedOffset,
      userId,
      action,
    });
  }

  /**
   * GET /audit/archived/stats
   * Returns aggregate compression statistics: total archived entries, average
   * compression ratio, bytes saved. Useful for dashboards and capacity
   * planning. Admin-only.
   */
  @Get('archived/stats')
  @Roles('admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('read', AuditLogSubject))
  getCompressionStats() {
    return this.auditArchiveService.getCompressionStats();
  }
}
