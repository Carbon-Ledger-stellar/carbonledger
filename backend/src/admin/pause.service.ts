import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { WebhookService } from '../webhook/webhook.service';
import { IBlockchainProvider, TransactionReceipt } from '../blockchain/interface';

/** Contracts that implement pause_operations / unpause_operations. */
export const PAUSABLE_CONTRACTS = ['carbon_credit', 'carbon_marketplace'] as const;
export type PausableContract = (typeof PAUSABLE_CONTRACTS)[number];

/** Contract-enforced upper bound on a pause window (see require_not_paused). */
export const MAX_PAUSE_WINDOW_SECONDS = 72 * 60 * 60;

export const PAUSE_TRACER_NAME = 'carbonledger.pause';

const CONTRACT_ID_ENV: Record<PausableContract, string> = {
  carbon_credit: 'CARBON_CREDIT_CONTRACT_ID',
  carbon_marketplace: 'CARBON_MARKETPLACE_CONTRACT_ID',
};

type PauseAction = 'pause' | 'unpause';

export interface PauseResult {
  contract: PausableContract;
  contractId: string;
  paused: boolean;
  pausedUntil: number | null;
  txHash: string;
  traceId: string;
  reason?: string | null;
  status?: string;
}

/**
 * PauseService — emergency pause/unpause of the Soroban contracts (#1307).
 *
 * Each operation produces one trace:
 *
 *   pause.pause_contract | pause.unpause_contract     (root, INTERNAL)
 *     ├─ pause.contract_call   invoke pause_operations / unpause_operations
 *     ├─ pause.db_update       AdminConfig state + hash-chained AuditLog row
 *     └─ pause.event_emit      contract.paused / contract.unpaused webhooks
 *
 * Every step is its own span so Jaeger shows per-step latency, and the trace
 * id is written to the audit log and to the structured log line so a trace can
 * be found from logs (and vice versa).
 */
@Injectable()
export class PauseService {
  private readonly logger = new Logger(PauseService.name);
  private readonly tracer = trace.getTracer(PAUSE_TRACER_NAME);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly webhookService: WebhookService,
    @Inject('IBlockchainProvider') private readonly blockchain: IBlockchainProvider,
  ) {}

  async pauseContract(
    contract: PausableContract,
    adminAddress: string,
    untilTimestamp: number,
    reason?: string,
  ): Promise<PauseResult> {
    const now = Math.floor(Date.now() / 1000);
    if (untilTimestamp <= now || untilTimestamp > now + MAX_PAUSE_WINDOW_SECONDS) {
      throw new BadRequestException(
        `untilTimestamp must be in the future and at most ${MAX_PAUSE_WINDOW_SECONDS}s from now`,
      );
    }
    return this.run('pause', contract, adminAddress, untilTimestamp, reason);
  }

  async unpauseContract(
    contract: PausableContract,
    adminAddress: string,
    reason?: string,
  ): Promise<PauseResult> {
    return this.run('unpause', contract, adminAddress, null, reason);
  }

  /**
   * Idempotently pause a contract (#1221).
   * Accepts reason parameter (optional), emits event, returns updated status.
   * If already paused, returns updated status without error.
   */
  async pause(
    contract: PausableContract,
    adminAddress: string,
    untilTimestamp?: number,
    reason?: string,
  ) {
    const currentState = await this.getPauseState(contract);
    if (currentState.paused) {
      this.logger.log(
        JSON.stringify({
          msg: 'contract already paused, returning status idempotently',
          contract,
          reason,
        }),
      );
      return {
        contract,
        contractId: this.resolveContractId(contract),
        paused: true,
        pausedUntil: currentState.pausedUntil,
        status: 'paused',
        reason: reason ?? null,
        message: 'Contract is already paused',
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const targetUntil = untilTimestamp ?? now + MAX_PAUSE_WINDOW_SECONDS;

    const result = await this.pauseContract(contract, adminAddress, targetUntil, reason);
    return {
      ...result,
      status: 'paused',
      reason: reason ?? null,
    };
  }

  /**
   * Idempotently unpause a contract (#1222).
   * Logs unpause action for audit trail, emits event, returns updated status.
   * If already unpaused, returns updated status without error.
   */
  async unpause(
    contract: PausableContract,
    adminAddress: string,
    reason?: string,
  ) {
    const currentState = await this.getPauseState(contract);
    if (!currentState.paused) {
      this.logger.log(
        JSON.stringify({
          msg: 'contract already unpaused, returning status idempotently',
          contract,
          reason,
        }),
      );
      const contractId = this.resolveContractId(contract);
      // Log unpause action for audit trail (#1222)
      await this.auditService.createLog({
        userId: adminAddress,
        action: 'contract.unpause',
        resourceId: contractId,
        result: 'Success',
        after: { contract, paused: false, pausedUntil: null, reason: reason ?? null },
      });
      return {
        contract,
        contractId,
        paused: false,
        pausedUntil: null,
        status: 'unpaused',
        reason: reason ?? null,
        message: 'Contract is already unpaused',
      };
    }

    const result = await this.unpauseContract(contract, adminAddress, reason);
    return {
      ...result,
      status: 'unpaused',
      reason: reason ?? null,
    };
  }

  async getPauseState(contract: PausableContract) {
    const rows = await this.prisma.adminConfig.findMany({
      where: { key: { in: [this.configKey(contract, 'paused'), this.configKey(contract, 'paused_until')] } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const pausedUntil = Number(byKey.get(this.configKey(contract, 'paused_until')) ?? 0);
    const paused = byKey.get(this.configKey(contract, 'paused')) === 'true' && pausedUntil > Date.now() / 1000;
    return { contract, paused, pausedUntil: paused ? pausedUntil : null };
  }

  /**
   * Retrieve the full pause/unpause history with pagination and optional
   * date-range filtering (#1228).
   *
   * Results are ordered newest-first.  The caller may filter by:
   *   - contract     'credit' | 'marketplace'
   *   - action       'pause' | 'unpause'
   *   - startDate    ISO-8601; events at or after this timestamp
   *   - endDate      ISO-8601; events at or before this timestamp
   *   - limit        page size (default 20, max 100)
   *   - offset       zero-based row offset for page navigation
   */
  async getPauseHistory(query: {
    contract?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    data: Array<{
      id: string;
      contract: string;
      action: string;
      admin: string;
      reason: string | null;
      pausedUntil: Date | null;
      txHash: string;
      eventId: string | null;
      occurredAt: Date;
      createdAt: Date;
    }>;
    total: number;
    limit: number;
    offset: number;
  }> {
    const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100);
    const offset = Math.max(Number(query.offset ?? 0), 0);

    const where: Record<string, unknown> = {};
    if (query.contract) where['contract'] = query.contract;
    if (query.action) where['action'] = query.action;
    if (query.startDate || query.endDate) {
      where['occurredAt'] = {
        ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.pauseEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          contract: true,
          action: true,
          admin: true,
          reason: true,
          pausedUntil: true,
          txHash: true,
          eventId: true,
          occurredAt: true,
          createdAt: true,
        },
      }),
      this.prisma.pauseEvent.count({ where }),
    ]);

    return { data, total, limit, offset };
  }

  private async run(
    action: PauseAction,
    contract: PausableContract,
    adminAddress: string,
    untilTimestamp: number | null,
    reason?: string,
  ): Promise<PauseResult> {
    const contractId = this.resolveContractId(contract);
    const method = action === 'pause' ? 'pause_operations' : 'unpause_operations';

    return this.tracer.startActiveSpan(`pause.${action}_contract`, async (root) => {
      const traceId = root.spanContext().traceId;
      root.setAttributes({
        'carbonledger.pause.action': action,
        'carbonledger.contract.name': contract,
        'carbonledger.contract.id': contractId,
        'carbonledger.admin': adminAddress,
        ...(reason && { 'carbonledger.pause.reason': reason }),
        ...(untilTimestamp !== null && { 'carbonledger.pause.until': untilTimestamp }),
      });

      try {
        const receipt = await this.step('pause.contract_call', async (span) => {
          span.setAttributes({
            'rpc.system': 'soroban',
            'rpc.method': method,
            'carbonledger.contract.id': contractId,
          });
          const args = untilTimestamp === null ? [adminAddress] : [adminAddress, untilTimestamp];
          const result: TransactionReceipt = await this.blockchain.invokeContract({ contractId, method, args });
          span.setAttributes({
            'stellar.tx_hash': result.txHash,
            'stellar.ledger': result.ledger,
            'stellar.tx_status': result.status,
          });
          if (result.status !== 'success') {
            throw new Error(`${method} failed on ${contract}: ${result.error ?? 'unknown error'}`);
          }
          return result;
        });
        root.setAttribute('stellar.tx_hash', receipt.txHash);

        const paused = action === 'pause';
        await this.step('pause.db_update', async (span) => {
          span.setAttribute('db.system', 'postgresql');
          await this.prisma.$transaction([
            this.upsertConfig(this.configKey(contract, 'paused'), String(paused)),
            this.upsertConfig(this.configKey(contract, 'paused_until'), String(untilTimestamp ?? 0)),
          ]);
          await this.auditService.createLog({
            userId: adminAddress,
            action: `contract.${action}`,
            resourceId: contractId,
            result: 'Success',
            txHash: receipt.txHash,
            after: { contract, paused, pausedUntil: untilTimestamp, ...(reason ? { reason } : {}) },
            metadata: { traceId, ...(reason ? { reason } : {}) },
          });
          // Write a dedicated AuditLogEntry (sensitive-ops audit trail, #1227).
          // This entry is immutable — the audit_logs table has no delete/update
          // in application code, making it the canonical record for compliance.
          await this.prisma.auditLogEntry.create({
            data: {
              actor_id: adminAddress,
              action: `contract.${action}`,
              resource_type: 'PauseEvent',
              resource_id: contractId,
              details: {
                contract,
                action,
                admin: adminAddress,
                reason: reason ?? null,
                paused,
                pausedUntil: untilTimestamp,
                txHash: receipt.txHash,
                traceId,
                occurredAt: new Date().toISOString(),
              },
            },
          });
          // Write PauseEvent row for pause-history (#1228, #1232)
          try {
            if ((this.prisma as any).pauseEvent?.upsert) {
              const dbContract = contract === 'carbon_marketplace' ? 'marketplace' : 'credit';
              await (this.prisma as any).pauseEvent.upsert({
                where: {
                  txHash_action: {
                    txHash: receipt.txHash,
                    action,
                  },
                },
                create: {
                  contract: dbContract,
                  action,
                  admin: adminAddress,
                  reason: reason ?? null,
                  pausedUntil: untilTimestamp ? new Date(untilTimestamp * 1000) : null,
                  txHash: receipt.txHash,
                  occurredAt: new Date(),
                },
                update: {
                  reason: reason ?? null,
                },
              });
            }
          } catch (e) {
            this.logger.warn(`Failed to create or update PauseEvent: ${e}`);
          }
        });

        await this.step('pause.event_emit', async (span) => {
          const eventType = paused ? 'contract.paused' : 'contract.unpaused';
          span.setAttribute('carbonledger.event.type', eventType);
          await this.webhookService.dispatch(eventType, {
            contract,
            contractId,
            pausedUntil: untilTimestamp,
            txHash: receipt.txHash,
            admin: adminAddress,
            reason: reason ?? null,
          });
        });

        this.logger.log(
          JSON.stringify({ msg: `contract ${action}d`, contract, contractId, txHash: receipt.txHash, traceId, reason }),
        );

        return { contract, contractId, paused, pausedUntil: untilTimestamp, txHash: receipt.txHash, traceId, reason: reason ?? null };
      } catch (error) {
        recordError(root, error);
        this.logger.error(
          JSON.stringify({ msg: `contract ${action} failed`, contract, contractId, traceId, error: String(error) }),
        );
        throw error;
      } finally {
        root.end();
      }
    });
  }

  private step<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
    return this.tracer.startActiveSpan(name, async (span) => {
      try {
        return await fn(span);
      } catch (error) {
        recordError(span, error);
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private upsertConfig(key: string, value: string) {
    return this.prisma.adminConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
  }

  private configKey(contract: PausableContract, field: 'paused' | 'paused_until') {
    return `${contract}_${field}`;
  }

  private resolveContractId(contract: PausableContract): string {
    const contractId = process.env[CONTRACT_ID_ENV[contract]];
    if (!contractId) {
      throw new BadRequestException(`${CONTRACT_ID_ENV[contract]} is not configured`);
    }
    return contractId;
  }
}

function recordError(span: Span, error: unknown): void {
  span.recordException(error instanceof Error ? error : String(error));
  span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
}
