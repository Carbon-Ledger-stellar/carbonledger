import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { IndexerService } from '../indexer/indexer.service';
import { OracleService } from '../oracle/oracle.service';
import { StellarNetworkService, CanaryConfig } from '../common/stellar-network.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indexer: IndexerService,
    private readonly oracle: OracleService,
    private readonly stellarNetwork: StellarNetworkService,
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

  assignRole(publicKey: string, role: string) {
    return this.prisma.user.upsert({
      where:  { publicKey },
      update: { role },
      create: { publicKey, role },
    });
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

  // ── Canary deployment ───────────────────────────────────────────────────────

  /**
   * Return the current canary routing configuration together with live error-rate
   * metrics so operators can see the health of both contract targets at a glance.
   */
  getCanaryStatus(): {
    config: Readonly<CanaryConfig>;
    errorRates: { primary: number; canary: number };
  } {
    return {
      config:     this.stellarNetwork.getCanaryConfig(),
      errorRates: this.stellarNetwork.getErrorRates(),
    };
  }

  /**
   * Update the canary routing configuration at runtime.
   *
   * This is the programmatic counterpart of the POST /api/v1/admin/canary endpoint.
   * Grafana's alert-based auto-rollback also calls this path (trafficPct = 0).
   */
  updateCanary(config: Partial<CanaryConfig>): {
    config: Readonly<CanaryConfig>;
    errorRates: { primary: number; canary: number };
  } {
    const updated = this.stellarNetwork.setCanaryConfig(config);
    // Persist the new traffic percentage to AdminConfig so it survives restarts.
    this.prisma.adminConfig
      .upsert({
        where:  { key: 'canary_traffic_pct' },
        update: { value: String(updated.trafficPct) },
        create: { key: 'canary_traffic_pct', value: String(updated.trafficPct) },
      })
      .catch(() => null); // non-blocking — in-memory state is authoritative

    if (updated.canaryContractId !== null) {
      this.prisma.adminConfig
        .upsert({
          where:  { key: 'canary_contract_id' },
          update: { value: updated.canaryContractId },
          create: { key: 'canary_contract_id', value: updated.canaryContractId },
        })
        .catch(() => null);
    }

    return {
      config:     updated,
      errorRates: this.stellarNetwork.getErrorRates(),
    };
  }
}
