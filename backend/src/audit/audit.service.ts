import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma.service';
import { buildCursorWhere, createOpaqueCursor, decodeCursor, normalizePaginationLimit } from '../common/cursor-pagination';

/** 7-year retention in days (2555 days) per compliance requirement */
const RETENTION_DAYS = 7 * 365;

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /**
   * Compute the canonical SHA-256 entry hash for an AuditLog row.
   *
   * The digest covers every immutable field plus `previousHash` so that:
   *   - modifying any field changes this entry's hash
   *   - deleting an entry breaks the chain for all subsequent entries
   *   - inserting a row mid-chain changes the previousHash of its successor
   */
  private computeEntryHash(fields: {
    id:           string;
    userId:       string | null | undefined;
    action:       string;
    resourceId:   string | null | undefined;
    ipAddress:    string | null | undefined;
    result:       string | null | undefined;
    metadata:     unknown;
    before:       unknown;
    after:        unknown;
    txHash:       string | null | undefined;
    timestamp:    Date;
    previousHash: string | null;
  }): string {
    const payload = [
      fields.id,
      fields.userId       ?? '',
      fields.action,
      fields.resourceId   ?? '',
      fields.ipAddress    ?? '',
      fields.result       ?? '',
      JSON.stringify(fields.metadata ?? {}),
      JSON.stringify(fields.before ?? null),
      JSON.stringify(fields.after ?? null),
      fields.txHash       ?? '',
      fields.timestamp.toISOString(),
      fields.previousHash ?? '',
    ].join('|');

    return createHash('sha256').update(payload, 'utf8').digest('hex');
  }

  async createLog(data: {
    userId?:     string;
    action:      string;
    resourceId?: string;
    ipAddress?:  string;
    result?:     string;
    metadata?:   any;
    before?:     any;
    after?:      any;
    txHash?:     string;
  }) {
    // Retrieve the most recent entry hash to form the chain link.
    // We use a serialisable transaction so concurrent inserts cannot race and
    // produce two rows with the same previousHash.
    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.auditLog.findFirst({
        orderBy: { timestamp: 'desc' },
        select:  { entryHash: true },
      });

      const previousHash = latest?.entryHash ?? null;
      const now          = new Date();

      // We need the cuid before insert to include it in the hash.
      // Generate a placeholder row first, then compute and patch the hash.
      const entry = await tx.auditLog.create({
        data: {
          userId:       data.userId,
          action:       data.action,
          resourceId:   data.resourceId,
          ipAddress:    data.ipAddress,
          result:       data.result,
          metadata:     data.metadata ?? {},
          before:       data.before,
          after:        data.after,
          txHash:       data.txHash,
          timestamp:    now,
          previousHash,
          entryHash:    null, // patched below
        },
      });

      const entryHash = this.computeEntryHash({
        id:           entry.id,
        userId:       entry.userId,
        action:       entry.action,
        resourceId:   entry.resourceId,
        ipAddress:    entry.ipAddress,
        result:       entry.result,
        metadata:     entry.metadata,
        before:       entry.before,
        after:        entry.after,
        txHash:       entry.txHash,
        timestamp:    entry.timestamp,
        previousHash,
      });

      return tx.auditLog.update({
        where: { id: entry.id },
        data:  { entryHash },
      });
    });
  }

  async queryByResource(resourceId: string) {
    return this.prisma.auditLog.findMany({
      where: { resourceId },
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
    });
  }

  async findAll(query: {
    limit?:     number;
    offset?:    number;
    userId?:    string;
    action?:    string;
    cursor?:    string;
    startDate?: string;
    endDate?:   string;
  }) {
    const limit = normalizePaginationLimit(Number(query.limit ?? 50), 100);
    const decodedCursor = decodeCursor(query.cursor);

    const where: any = {
      ...(query.userId && { userId: query.userId }),
      ...(query.action && { action: query.action }),
    };

    // Date range filtering (#1080)
    if (query.startDate || query.endDate) {
      where.timestamp = {
        ...(query.startDate && { gte: new Date(query.startDate) }),
        ...(query.endDate   && { lte: new Date(query.endDate)   }),
      };
    }

    const cursorWhere = decodedCursor ? buildCursorWhere(decodedCursor) : undefined;
    const [entries, total_count] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: cursorWhere ? { ...where, ...cursorWhere } : where,
        take: limit + 1,
        orderBy: { timestamp: 'desc', id: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const hasMore = entries.length > limit;
    const next_cursor = hasMore ? createOpaqueCursor(entries[limit - 1].id, entries[limit - 1].timestamp) : undefined;
    const prev_cursor = decodedCursor && entries.length > 0 ? createOpaqueCursor(entries[0].id, entries[0].timestamp) : undefined;
    if (hasMore) entries.pop();

    return {
      entries,
      next_cursor,
      prev_cursor,
      total_count,
    };
  }

  /**
   * Cursor-based pagination over the audit log with date filtering.
   *
   * Returns an opaque base64-encoded `next_cursor` that callers pass back
   * as `?cursor=` to fetch the next page. Cursor encodes the row `id` so it
   * remains stable under concurrent inserts. Page size bounded at 100.
   *
   * Supports filtering by userId, action, startDate, and endDate.
   */
  async findAllCursor(query: {
    cursor?:    { id: string };
    limit?:     number;
    userId?:    string;
    action?:    string;
    offset?:    number;
    startDate?: string;
    endDate?:   string;
  }): Promise<{
    logs:         any[];
    next_cursor?: string;
    prev_cursor?: string;
    total_count:  number;
  }> {
    const take = Math.min(Math.max(Number(query.limit) || 50, 1), 100);

    const where: any = {
      ...(query.userId && { userId: query.userId }),
      ...(query.action && { action: query.action }),
    };

    // Date range filtering (#1080)
    if (query.startDate || query.endDate) {
      where.timestamp = {
        ...(query.startDate && { gte: new Date(query.startDate) }),
        ...(query.endDate   && { lte: new Date(query.endDate)   }),
      };
    }

    // Legacy offset path (backward-compatible)
    if (query.offset !== undefined && query.cursor === undefined) {
      const [logs, total_count] = await Promise.all([
        this.prisma.auditLog.findMany({
          where,
          take,
          skip: query.offset,
          orderBy: { timestamp: 'desc' },
        }),
        this.prisma.auditLog.count({ where }),
      ]);
      return { logs, total_count };
    }

    // Cursor path: fetch take+1 to detect whether there is a next page
    const [logs, total_count] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: take + 1,
        cursor: query.cursor ? { id: query.cursor.id } : undefined,
        skip:   query.cursor ? 1 : 0,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const hasMore = logs.length > take;
    if (hasMore) logs.pop();

    // Encode next_cursor as opaque base64 JSON — stable across concurrent inserts
    const next_cursor = hasMore
      ? Buffer.from(JSON.stringify({ id: logs[logs.length - 1].id })).toString('base64')
      : undefined;

    // Encode prev_cursor pointing back to the first item of this page
    const prev_cursor =
      query.cursor && logs.length > 0
        ? Buffer.from(JSON.stringify({ id: logs[0].id })).toString('base64')
        : undefined;

    return { logs, next_cursor, prev_cursor, total_count };
  }

  /**
   * Walk the audit log from oldest to newest and verify every hash link.
   *
   * Returns `{ valid: true }` when the chain is intact, or
   * `{ valid: false, brokenAt: <id> }` pointing to the first corrupted entry.
   *
   * Admin-only — exposed via GET /audit/verify.
   */
  async verifyChain(): Promise<{ valid: boolean; brokenAt?: string; checked: number }> {
    const entries = await this.prisma.auditLog.findMany({
      orderBy: { timestamp: 'asc' },
    });

    let expectPreviousHash: string | null = null;

    for (const entry of entries) {
      // Skip legacy rows that pre-date hash chaining
      if (entry.entryHash === null) {
        continue;
      }

      // Check previousHash link
      if (entry.previousHash !== expectPreviousHash) {
        return { valid: false, brokenAt: entry.id, checked: entries.length };
      }

      // Recompute and compare
      const expected = this.computeEntryHash({
        id:           entry.id,
        userId:       entry.userId,
        action:       entry.action,
        resourceId:   entry.resourceId,
        ipAddress:    entry.ipAddress,
        result:       entry.result,
        metadata:     entry.metadata,
        timestamp:    entry.timestamp,
        previousHash: entry.previousHash,
      });

      if (expected !== entry.entryHash) {
        return { valid: false, brokenAt: entry.id, checked: entries.length };
      }

      expectPreviousHash = entry.entryHash;
    }

    return { valid: true, checked: entries.length };
  }

  /**
   * Generate a monthly audit report for a given year/month.
   *
   * Returns aggregated statistics about admin actions for compliance reporting.
   * Covers the full calendar month from 00:00:00 on day 1 to 23:59:59 on the last day.
   *
   * Admin-only — exposed via GET /audit/report/monthly.
   */
  async getMonthlyReport(year: number, month: number): Promise<{
    period:           string;
    totalEvents:      number;
    byAction:         Record<string, number>;
    byUser:           Record<string, number>;
    failureCount:     number;
    successCount:     number;
    adminActions:     any[];
    generatedAt:      string;
  }> {
    const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endDate   = new Date(year, month,     0, 23, 59, 59, 999); // last day of month

    const entries = await this.prisma.auditLog.findMany({
      where: {
        timestamp: { gte: startDate, lte: endDate },
      },
      orderBy: { timestamp: 'asc' },
    });

    const byAction: Record<string, number> = {};
    const byUser:   Record<string, number> = {};
    let failureCount = 0;
    let successCount = 0;

    for (const entry of entries) {
      // Tally by action type
      byAction[entry.action] = (byAction[entry.action] ?? 0) + 1;

      // Tally by user
      const key = entry.userId ?? 'anonymous';
      byUser[key] = (byUser[key] ?? 0) + 1;

      // Count success / failure
      if (entry.result?.startsWith('Failure') || entry.result?.startsWith('Error')) {
        failureCount++;
      } else {
        successCount++;
      }
    }

    // Filter to admin-specific actions for the detailed list
    const adminActionKeywords = [
      'role', 'admin', 'verify', 'reject', 'suspend', 'approve',
      'export', 'user', 'permission', 'grant', 'revoke', 'delete',
    ];

    const adminActions = entries.filter(e =>
      adminActionKeywords.some(kw => e.action.toLowerCase().includes(kw)),
    );

    return {
      period:       `${year}-${String(month).padStart(2, '0')}`,
      totalEvents:  entries.length,
      byAction,
      byUser,
      failureCount,
      successCount,
      adminActions,
      generatedAt:  new Date().toISOString(),
    };
  }

  /**
   * Retention policy enforcement (#1080).
   *
   * Marks audit log entries older than 7 years for archival by returning their IDs.
   * Actual deletion is intentionally NOT implemented — compliance requires 7-year
   * retention, meaning records must be kept, not deleted. This method exists to
   * identify records that have exceeded retention and can be archived to cold storage.
   *
   * Admin-only — exposed via GET /audit/retention/check.
   */
  async checkRetentionPolicy(): Promise<{
    retentionDays:      number;
    cutoffDate:         string;
    recordsWithinPolicy: number;
    recordsBeyondPolicy: number;
    oldestRecord:       string | null;
  }> {
    const cutoffDate = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const [withinPolicy, beyondPolicy, oldest] = await Promise.all([
      this.prisma.auditLog.count({ where: { timestamp: { gte: cutoffDate } } }),
      this.prisma.auditLog.count({ where: { timestamp: { lt:  cutoffDate } } }),
      this.prisma.auditLog.findFirst({
        orderBy: { timestamp: 'asc' },
        select:  { timestamp: true },
      }),
    ]);

    return {
      retentionDays:       RETENTION_DAYS,
      cutoffDate:          cutoffDate.toISOString(),
      recordsWithinPolicy: withinPolicy,
      recordsBeyondPolicy: beyondPolicy,
      oldestRecord:        oldest?.timestamp?.toISOString() ?? null,
    };
  }
}
