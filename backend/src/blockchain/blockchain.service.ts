import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SorobanRpc } from '@stellar/stellar-sdk';

const DEFAULT_RPC_TIMEOUT_MS = 10_000;
const DEFAULT_RPC_RETRY_AFTER_SECONDS = 5;

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private readonly server: SorobanRpc.Server;
  private readonly rpcTimeoutMs: number;
  private readonly rpcRetryAfterSeconds: number;

  constructor(private readonly configService: ConfigService) {
    const rpcUrl = this.configService.get<string>('SOROBAN_RPC_URL');
    this.server = new SorobanRpc.Server(rpcUrl, { allowHttp: true });

    this.rpcTimeoutMs = this.readPositiveInt(
      'SOROBAN_RPC_TIMEOUT_MS',
      DEFAULT_RPC_TIMEOUT_MS,
    );
    this.rpcRetryAfterSeconds = this.readPositiveInt(
      'SOROBAN_RPC_RETRY_AFTER_SECONDS',
      DEFAULT_RPC_RETRY_AFTER_SECONDS,
    );
  }

  private readPositiveInt(key: string, fallback: number): number {
    const raw = this.configService.get<string | number>(key);
    const parsed = typeof raw === 'number' ? raw : parseInt(raw ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  /**
   * Wraps a Soroban RPC call with a configurable timeout and records
   * latency/failure metrics. On timeout, throws a 503 with a retry hint.
   */
  private async callRpc<T>(
    operation: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Soroban RPC timeout after ${this.rpcTimeoutMs}ms`));
      }, this.rpcTimeoutMs);
    });

    try {
      const result = await Promise.race([fn(), timeout]);
      this.recordRpcMetric(operation, 'success', Date.now() - startedAt);
      return result;
    } catch (error) {
      const elapsed = Date.now() - startedAt;
      const isTimeout =
        error instanceof Error && error.message.includes('Soroban RPC timeout');

      this.recordRpcMetric(
        operation,
        isTimeout ? 'timeout' : 'failure',
        elapsed,
      );

      if (isTimeout) {
        this.logger.warn(
          `Soroban RPC call "${operation}" timed out after ${this.rpcTimeoutMs}ms`,
        );
        throw new ServiceUnavailableException({
          statusCode: 503,
          error: 'Service Unavailable',
          message: `Soroban RPC is slow or unavailable. Please retry in ${this.rpcRetryAfterSeconds}s.`,
          retryAfter: this.rpcRetryAfterSeconds,
        });
      }

      this.logger.error(
        `Soroban RPC call "${operation}" failed after ${elapsed}ms: ${(error as Error)?.message}`,
      );
      throw error;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private recordRpcMetric(
    operation: string,
    outcome: 'success' | 'failure' | 'timeout',
    latencyMs: number,
  ): void {
    this.logger.debug(
      `metric soroban_rpc_latency_ms{operation="${operation}",outcome="${outcome}"} ${latencyMs}`,
    );
    if (outcome !== 'success') {
      this.logger.debug(
        `metric soroban_rpc_failures_total{operation="${operation}",outcome="${outcome}"} 1`,
      );
    }
  }

  async getLatestLedger(): Promise<SorobanRpc.Api.GetLatestLedgerResponse> {
    return this.callRpc('getLatestLedger', () => this.server.getLatestLedger());
  }

  async getAccount(accountId: string): Promise<SorobanRpc.Api.AccountResponse> {
    return this.callRpc('getAccount', () => this.server.getAccount(accountId));
  }

  async simulateTransaction(
    transaction: Parameters<SorobanRpc.Server['simulateTransaction']>[0],
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse> {
    return this.callRpc('simulateTransaction', () =>
      this.server.simulateTransaction(transaction),
    );
  }

  async getTransaction(
    hash: string,
  ): Promise<SorobanRpc.Api.GetTransactionResponse> {
    return this.callRpc('getTransaction', () => this.server.getTransaction(hash));
  }

  async sendTransaction(
    transaction: Parameters<SorobanRpc.Server['sendTransaction']>[0],
  ): Promise<SorobanRpc.Api.SendTransactionResponse> {
    return this.callRpc('sendTransaction', () =>
      this.server.sendTransaction(transaction),
    );
  }
}
