import { Injectable, Logger } from '@nestjs/common';
import { SorobanRpc } from '@stellar/stellar-sdk';

const HTTP_TIMEOUT_MS = 2500;
const HORIZON_HEALTH_PATH = '/ledgers?limit=1';

@Injectable()
export class StellarNetworkService {
  private readonly logger = new Logger(StellarNetworkService.name);
  private readonly horizonUrl: string;
  private readonly rpc: SorobanRpc.Server;
  private lastHorizonStatus: string | null = null;
  private lastRpcStatus: string | null = null;

  constructor() {
    this.horizonUrl = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
    this.rpc = new SorobanRpc.Server(process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org');
  }

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
