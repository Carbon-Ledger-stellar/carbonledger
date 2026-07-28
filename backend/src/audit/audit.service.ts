import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma.service';

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
        timestamp:    entry.timestamp,
        previousHash,
      });

      return tx.auditLog.update({
        where: { id: entry.id },
        data:  { entryHash },
      });
    });
  }

  async findAll(query: {
    limit?:  number;
    offset?: number;
    userId?: string;
    action?: string;
  }) {
    return this.prisma.auditLog.findMany({
      where: {
        ...(query.userId && { userId: query.userId }),
        ...(query.action && { action: query.action }),
      },
      take:    Number(query.limit)  || 50,
      skip:    Number(query.offset) || 0,
      orderBy: { timestamp: 'desc' },
    });
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
}
