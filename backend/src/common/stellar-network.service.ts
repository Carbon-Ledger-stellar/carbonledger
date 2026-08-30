import { Injectable, Logger } from '@nestjs/common';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { contractCallsRegistry, ContractLabel } from './metrics.registry';

const HTTP_TIMEOUT_MS = 2500;
const HORIZON_HEALTH_PATH = '/ledgers?limit=1';

/**
 * Canary routing state — mutable at runtime via the admin API.
 *
 * canaryContractId:  The new contract address being tested.
 *                    When null (or empty string), canary routing is disabled.
 * trafficPct:        Percentage (0–100) of calls routed to the canary contract.
 *                    Defaults to 0; changed at runtime by the admin endpoint.
 */
export interface CanaryConfig {
  canaryContractId: string | null;
  trafficPct: number;
}

@Injectable()
export class StellarNetworkService {
  private readonly logger = new Logger(StellarNetworkService.name);
  private readonly horizonUrl: string;
  private readonly rpc: SorobanRpc.Server;
  private lastHorizonStatus: string | null = null;
  private lastRpcStatus: string | null = null;

  /** Live canary configuration — mutated by the admin canary endpoint. */
  private canaryConfig: CanaryConfig;

  constructor() {
    this.horizonUrl = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
    this.rpc = new SorobanRpc.Server(
      process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
    );

    const rawPct = parseInt(process.env.CANARY_TRAFFIC_PCT ?? '0', 10);
    this.canaryConfig = {
      canaryContractId: process.env.CANARY_CONTRACT_ID || null,
      trafficPct: isNaN(rawPct) ? 0 : Math.min(100, Math.max(0, rawPct)),
    };

    this.logger.log(
      `Canary config initialised: contractId=${this.canaryConfig.canaryContractId ?? 'none'}, trafficPct=${this.canaryConfig.trafficPct}`,
    );
  }

  // ── Canary routing ──────────────────────────────────────────────────────────

  /**
   * Returns the current canary configuration (read-only snapshot).
   */
  getCanaryConfig(): Readonly<CanaryConfig> {
    return { ...this.canaryConfig };
  }

  /**
   * Update canary configuration at runtime.
   * Called by POST /api/v1/admin/canary.
   */
  setCanaryConfig(config: Partial<CanaryConfig>): CanaryConfig {
    if (config.canaryContractId !== undefined) {
      this.canaryConfig.canaryContractId = config.canaryContractId || null;
    }
    if (config.trafficPct !== undefined) {
      this.canaryConfig.trafficPct = Math.min(100, Math.max(0, config.trafficPct));
    }
    this.logger.log(
      `Canary config updated: contractId=${this.canaryConfig.canaryContractId ?? 'none'}, trafficPct=${this.canaryConfig.trafficPct}`,
    );
    return { ...this.canaryConfig };
  }

  /**
   * Decide whether this particular call should go to the canary contract.
   *
   * Decision rules:
   *  - If canaryContractId is not set → always primary.
   *  - If trafficPct is 0             → always primary.
   *  - Otherwise use Math.random() to sample the configured percentage.
   */
  private shouldUseCanary(): boolean {
    if (!this.canaryConfig.canaryContractId) return false;
    if (this.canaryConfig.trafficPct <= 0) return false;
    return Math.random() * 100 < this.canaryConfig.trafficPct;
  }

  /**
   * Resolve the contract address to call and the associated routing label.
   *
   * @param primaryContractId  The currently-deployed (primary) contract address.
   * @returns  { contractId, label } — label is used for Prometheus counters.
   */
  resolveContract(primaryContractId: string): { contractId: string; label: ContractLabel } {
    if (this.shouldUseCanary() && this.canaryConfig.canaryContractId) {
      return { contractId: this.canaryConfig.canaryContractId, label: 'canary' };
    }
    return { contractId: primaryContractId, label: 'primary' };
  }

  /**
   * Record the outcome of a contract call in the Prometheus counter.
   *
   * Usage:
   *   const { contractId, label } = service.resolveContract(primaryId);
   *   try {
   *     await callContract(contractId, ...);
   *     service.recordCall(label, 'success');
   *   } catch (err) {
   *     service.recordCall(label, 'error');
   *     throw err;
   *   }
   */
  recordCall(contract: ContractLabel, status: 'success' | 'error'): void {
    contractCallsRegistry.increment(contract, status);
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.setAttribute('stellar.contract_label', contract);
      activeSpan.setAttribute('stellar.call_status', status);
    }
  }

  /**
   * Wraps Stellar / Soroban contract invocations in OpenTelemetry active spans.
   */
  async traceContractCall<T>(
    contractId: string,
    method: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const tracer = trace.getTracer('carbonledger.stellar');
    return tracer.startActiveSpan(`stellar contract ${method}`, async (span) => {
      span.setAttributes({
        'stellar.contract_id': contractId,
        'stellar.method': method,
      });
      try {
        const result = await operation();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err: any) {
        span.recordException(err instanceof Error ? err : String(err));
        span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
        throw err;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Compute per-contract error rates from the in-memory counters.
   * Returns values in [0, 1] (e.g. 0.05 = 5%).
   */
  getErrorRates(): { primary: number; canary: number } {
    const pSuccess = contractCallsRegistry.get('primary', 'success');
    const pError   = contractCallsRegistry.get('primary', 'error');
    const cSuccess = contractCallsRegistry.get('canary',  'success');
    const cError   = contractCallsRegistry.get('canary',  'error');

    const primaryTotal = pSuccess + pError;
    const canaryTotal  = cSuccess + cError;

    return {
      primary: primaryTotal > 0 ? pError   / primaryTotal : 0,
      canary:  canaryTotal  > 0 ? cError   / canaryTotal  : 0,
    };
  }

  // ── Connectivity checks ─────────────────────────────────────────────────────

  private async fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = HTTP_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return `${error.message}${error.stack ? `\n${error.stack}` : ''}`;
    }
    return String(error);
  }

  async checkHorizon(): Promise<{ healthy: boolean; details: string | null }> {
    try {
      const url = `${this.horizonUrl}${HORIZON_HEALTH_PATH}`;
      const res = await this.fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => `Status ${res.status}`);
        throw new Error(`Horizon responded with ${res.status}: ${errorText}`);
      }

      this.lastHorizonStatus = null;
      return { healthy: true, details: null };
    } catch (error) {
      const errorDetails = this.formatError(error);
      this.logger.error(`Horizon connectivity check failed: ${errorDetails}`);
      this.lastHorizonStatus = errorDetails;
      return { healthy: false, details: errorDetails };
    }
  }

  async checkSorobanRpc(): Promise<{ healthy: boolean; details: string | null }> {
    try {
      const latestLedger = await this.rpc.getLatestLedger();
      if (!latestLedger || typeof latestLedger.sequence !== 'number') {
        throw new Error('Soroban RPC returned invalid ledger payload');
      }
      this.lastRpcStatus = null;
      return { healthy: true, details: null };
    } catch (error) {
      const errorDetails = this.formatError(error);
      this.logger.error(`Soroban RPC connectivity check failed: ${errorDetails}`);
      this.lastRpcStatus = errorDetails;
      return { healthy: false, details: errorDetails };
    }
  }

  async checkConnectivity() {
    const horizon = await this.checkHorizon();
    const rpc = await this.checkSorobanRpc();
    return {
      healthy: horizon.healthy && rpc.healthy,
      horizon,
      rpc,
    };
  }

  getLastStatus() {
    return {
      horizon: this.lastHorizonStatus,
      rpc: this.lastRpcStatus,
    };
  }
}
