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

  async pauseContract(contract: PausableContract, adminAddress: string, untilTimestamp: number): Promise<PauseResult> {
    const now = Math.floor(Date.now() / 1000);
    if (untilTimestamp <= now || untilTimestamp > now + MAX_PAUSE_WINDOW_SECONDS) {
      throw new BadRequestException(
        `untilTimestamp must be in the future and at most ${MAX_PAUSE_WINDOW_SECONDS}s from now`,
      );
    }
    return this.run('pause', contract, adminAddress, untilTimestamp);
  }

  async unpauseContract(contract: PausableContract, adminAddress: string): Promise<PauseResult> {
    return this.run('unpause', contract, adminAddress, null);
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

  private async run(
    action: PauseAction,
    contract: PausableContract,
    adminAddress: string,
    untilTimestamp: number | null,
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
            after: { contract, paused, pausedUntil: untilTimestamp },
            metadata: { traceId },
          });
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
          });
        });

        this.logger.log(
          JSON.stringify({ msg: `contract ${action}d`, contract, contractId, txHash: receipt.txHash, traceId }),
        );

        return { contract, contractId, paused, pausedUntil: untilTimestamp, txHash: receipt.txHash, traceId };
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
