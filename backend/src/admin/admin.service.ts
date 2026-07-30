import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { IndexerService } from '../indexer/indexer.service';
import { OracleService } from '../oracle/oracle.service';
import { RedisService } from '../redis.service';
import { StellarNetworkService } from '../common/stellar-network.service';
import { UpdateCanaryDto } from './admin.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indexer: IndexerService,
    private readonly oracle: OracleService,
    private readonly redis: RedisService,
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

  // ── Canary deployment ─────────────────────────────────────────────────────

  updateCanary(dto: UpdateCanaryDto) {
    const config = this.stellarNetwork.setCanaryConfig({
      canaryContractId: dto.canaryContractId,
      trafficPct: dto.trafficPct,
    });

    if (dto.trafficPct !== undefined) {
      void this.prisma.adminConfig.upsert({
        where: { key: 'canary_traffic_pct' },
        update: { value: String(config.trafficPct) },
        create: { key: 'canary_traffic_pct', value: String(config.trafficPct) },
      });
    }

    if (dto.canaryContractId !== undefined) {
      const contractValue = config.canaryContractId ?? '';
      void this.prisma.adminConfig.upsert({
        where: { key: 'canary_contract_id' },
        update: { value: contractValue },
        create: { key: 'canary_contract_id', value: contractValue },
      });
    }

    return { config };
  }

  getCanaryStatus() {
    return {
      config: this.stellarNetwork.getCanaryConfig(),
      errorRates: this.stellarNetwork.getErrorRates(),
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

  // ── Abuse Log ───────────────────────────────────────────────────────────────

  async getAbuseLog() {
    const client = this.redis.getClient();
    if (!client) return [];
    
    const logs = await client.lrange('abuse:log', 0, -1);
    return logs.map(log => JSON.parse(log));
  }
}
