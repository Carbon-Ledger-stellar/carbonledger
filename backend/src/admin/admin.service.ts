import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { IndexerService } from '../indexer/indexer.service';
import { OracleService } from '../oracle/oracle.service';
import { RedisService } from '../redis.service';
import { StellarNetworkService } from '../common/stellar-network.service';
import { UpdateCanaryDto } from './admin.dto';
import { ProjectsService } from '../projects/projects.service';
import { CreditsService } from '../credits/credits.service';
import { RetirementsService } from '../retirements/retirements.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indexer: IndexerService,
    private readonly oracle: OracleService,
    private readonly redis: RedisService,
    private readonly stellarNetwork: StellarNetworkService,
    private readonly projectsService: ProjectsService,
    private readonly creditsService: CreditsService,
    private readonly retirementsService: RetirementsService,
    private readonly auditService: AuditService,
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

  // ── Satellite quarantine queue (#579) ───────────────────────────────────────

  /**
   * The `id` column is a BigInt, which `JSON.stringify` refuses to serialise.
   * Every response path that touches a quarantine row goes through here.
   */
  private serializeQuarantine(entry: any) {
    return { ...entry, id: entry.id.toString() };
  }

  /**
   * Submissions held by the oracle's anomaly detection for manual review.
   *
   * Defaults to `pending` — the queue an operator actually works through.
   * Pass `status=approved|rejected` to audit past decisions.
   */
  async listQuarantine(query: { status?: string; limit?: number; offset?: number }) {
    const status = query.status ?? 'pending';
    const [entries, total] = await Promise.all([
      this.prisma.satelliteQuarantine.findMany({
        where:   status === 'all' ? undefined : { status },
        take:    Math.min(Number(query.limit) || 50, 200),
        skip:    Number(query.offset) || 0,
        orderBy: { quarantinedAt: 'desc' },
      }),
      this.prisma.satelliteQuarantine.count({
        where: status === 'all' ? undefined : { status },
      }),
    ]);

    return { entries: entries.map((e) => this.serializeQuarantine(e)), total, status };
  }

  /** Count of entries awaiting review — for dashboards and alert thresholds. */
  async getQuarantineDepth() {
    const pending = await this.prisma.satelliteQuarantine.count({
      where: { status: 'pending' },
    });
    return { pending };
  }

  async getQuarantineEntry(id: string) {
    const entry = await this.prisma.satelliteQuarantine.findUnique({
      where: { id: BigInt(id) },
    });
    if (!entry) {
      throw new NotFoundException(`Quarantine entry ${id} not found`);
    }
    return this.serializeQuarantine(entry);
  }

  /**
   * Record a reviewer's decision on a quarantined submission.
   *
   * Approving does **not** resubmit the data on chain — it clears the hold so
   * the provider's next submission for that period is accepted normally. Auto-
   * submitting from here would bypass the IPFS integrity and consensus checks
   * the payload never reached.
   *
   * Only pending entries can be reviewed, so two admins cannot silently
   * overwrite each other's decision.
   */
  async reviewQuarantineEntry(
    id: string,
    decision: string,
    reviewedBy: string,
    note?: string,
  ) {
    const entry = await this.prisma.satelliteQuarantine.findUnique({
      where: { id: BigInt(id) },
    });
    if (!entry) {
      throw new NotFoundException(`Quarantine entry ${id} not found`);
    }
    if (entry.status !== 'pending') {
      throw new ConflictException(
        `Quarantine entry ${id} was already ${entry.status}`,
      );
    }

    const updated = await this.prisma.satelliteQuarantine.update({
      where: { id: BigInt(id) },
      data:  {
        status:     decision,
        reviewedBy,
        reviewNote: note ?? null,
        reviewedAt: new Date(),
      },
    });

    return this.serializeQuarantine(updated);
  }

  // ── Soft delete / recovery (#964) ───────────────────────────────────────────
  //
  // Delete + restore for Project/Credit/Retirement all funnel through here so
  // every one of them lands in the tamper-evident audit chain (AuditService),
  // regardless of which resource module actually owns the row. The resource
  // services (ProjectsService/CreditsService/RetirementsService) do the actual
  // deletedAt mutation and enforce "not already deleted/not already active".

  async softDeleteProject(projectId: string, actor: string, reason?: string) {
    const deleted = await this.projectsService.softDeleteProject(projectId, reason ?? 'Deleted by admin');
    await this.auditService.createLog({
      userId: actor,
      action: 'project.soft_delete',
      resourceId: projectId,
      result: 'success',
      metadata: { reason },
    });
    return deleted;
  }

  async restoreProject(projectId: string, actor: string) {
    const restored = await this.projectsService.restoreProject(projectId);
    await this.auditService.createLog({
      userId: actor,
      action: 'project.restore',
      resourceId: projectId,
      result: 'success',
    });
    return restored;
  }

  async softDeleteCreditBatch(batchId: string, actor: string, reason?: string) {
    const deleted = await this.creditsService.softDeleteBatch(batchId);
    await this.auditService.createLog({
      userId: actor,
      action: 'credit_batch.soft_delete',
      resourceId: batchId,
      result: 'success',
      metadata: { reason },
    });
    return deleted;
  }

  async restoreCreditBatch(batchId: string, actor: string) {
    const restored = await this.creditsService.restoreBatch(batchId);
    await this.auditService.createLog({
      userId: actor,
      action: 'credit_batch.restore',
      resourceId: batchId,
      result: 'success',
    });
    return restored;
  }

  async softDeleteRetirement(retirementId: string, actor: string, reason?: string) {
    const deleted = await this.retirementsService.softDeleteRetirement(retirementId);
    await this.auditService.createLog({
      userId: actor,
      action: 'retirement.soft_delete',
      resourceId: retirementId,
      result: 'success',
      metadata: { reason },
    });
    return deleted;
  }

  async restoreRetirement(retirementId: string, actor: string) {
    const restored = await this.retirementsService.restoreRetirement(retirementId);
    await this.auditService.createLog({
      userId: actor,
      action: 'retirement.restore',
      resourceId: retirementId,
      result: 'success',
    });
    return restored;
  }

  async purgeDeletedRecords() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [projects, batches, listings, retirements] = await this.prisma.$transaction([
      this.prisma.carbonProject.deleteMany({
        where: {
          deletedAt: { not: null, lt: thirtyDaysAgo },
        },
      }),
      this.prisma.creditBatch.deleteMany({
        where: {
          deletedAt: { not: null, lt: thirtyDaysAgo },
        },
      }),
      this.prisma.marketListing.deleteMany({
        where: {
          deletedAt: { not: null, lt: thirtyDaysAgo },
        },
      }),
      this.prisma.retirementRecord.deleteMany({
        where: {
          deletedAt: { not: null, lt: thirtyDaysAgo },
        },
      }),
    ]);

    return {
      success: true,
      purged: {
        projects: projects.count,
        batches: batches.count,
        listings: listings.count,
        retirements: retirements.count,
      },
    };
  }
}
