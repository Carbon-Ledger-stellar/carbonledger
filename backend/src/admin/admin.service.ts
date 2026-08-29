import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { IndexerService } from '../indexer/indexer.service';
import { OracleService } from '../oracle/oracle.service';
import { AccountLockoutService, LockoutInfo } from '../auth/account-lockout.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indexer: IndexerService,
    private readonly oracle: OracleService,
    private readonly lockout: AccountLockoutService,
  ) {}

  // ── Verifier whitelist ──────────────────────────────────────────────────────

  addVerifier(address: string) {
    return this.prisma.user.upsert({
      where:  { publicKey: address },
      update: { role: 'verifier' },
      create: { publicKey: address, role: 'verifier' },
    });
  }

  async removeVerifier(address: string) {
    await this.prisma.user.update({
      where: { publicKey: address },
      data:  { role: 'corporation' },
    });
    return { removed: true, address };
  }

  listVerifiers() {
    return this.prisma.user.findMany({ where: { role: 'verifier' } });
  }

  // ── Treasury ────────────────────────────────────────────────────────────────

  async updateTreasury(address: string) {
    // Stored as a named config entry in SyncMetadata-adjacent table.
    // We use a simple key/value approach via a dedicated AdminConfig model.
    return this.prisma.adminConfig.upsert({
      where:  { key: 'treasury_address' },
      update: { value: address },
      create: { key: 'treasury_address', value: address },
    });
  }

  getTreasury() {
    return this.prisma.adminConfig.findUnique({ where: { key: 'treasury_address' } });
  }

  // ── Oracle health ───────────────────────────────────────────────────────────

  async getOracleHealth() {
    const approvals = await this.oracle.getPriceApprovals();
    const pendingCount = approvals.filter(a => a.status === 'Pending').length;
    const latestMonitoring = await this.prisma.monitoringData.findFirst({
      orderBy: { submittedAt: 'desc' },
    });
    return {
      pendingPriceApprovals: pendingCount,
      latestMonitoringAt: latestMonitoring?.submittedAt ?? null,
      isMonitoringCurrent: latestMonitoring
        ? Date.now() - latestMonitoring.submittedAt.getTime() <= 365 * 24 * 60 * 60 * 1000
        : false,
    };
  }

  // ── Re-index ────────────────────────────────────────────────────────────────

  async triggerReindex() {
    // Reset the cursor so the next sync starts from ledger 0
    await this.prisma.syncMetadata.update({
      where: { id: 'singleton' },
      data:  { lastIndexedLedger: 0 },
    });
    // Fire-and-forget; sync() is idempotent and guarded by isIndexing flag
    this.indexer.sync().catch(() => null);
    return { triggered: true };
  }

  // ── Audit log ───────────────────────────────────────────────────────────────

  getAuditLogs(query: { limit?: number; offset?: number; action?: string }) {
    return this.prisma.auditLog.findMany({
      where:   query.action ? { action: { contains: query.action } } : undefined,
      take:    Number(query.limit)  || 50,
      skip:    Number(query.offset) || 0,
      orderBy: { timestamp: 'desc' },
    });
  }

  // ── Account lockout management ──────────────────────────────────────────────

  /**
   * Manually unlock an account that was locked due to too many failed attempts.
   * Resets the failed-attempt counter and removes any active lockout.
   */
  unlockAccount(publicKey: string): { unlocked: true; publicKey: string } {
    this.lockout.unlock(publicKey);
    return { unlocked: true, publicKey };
  }

  /**
   * Return current lockout state for the given public key.
   * Useful for auditing and investigating brute-force attempts.
   */
  getAccountLockoutInfo(publicKey: string): LockoutInfo {
    return this.lockout.getLockoutInfo(publicKey);
  }
}
