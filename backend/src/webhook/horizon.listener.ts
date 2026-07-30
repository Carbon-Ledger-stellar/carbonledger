import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { WEBHOOK_QUEUE_NAME } from '../queue/queue.constants';

/** Soroban contract topic symbols we care about (hex-encoded). */
const TRACKED_TOPICS = new Set(['c_ledger']);

export interface HorizonEvent {
  type: 'credit_minted' | 'credit_retired' | 'project_verified';
  contractId: string;
  ledger: number;
  txHash: string;
  payload: Record<string, unknown>;
}

/**
 * Subscribes to the Stellar Horizon /events SSE stream for all four contract
 * addresses and enqueues a HORIZON_EVENT job for each relevant event.
 *
 * Reconnects automatically on stream error with exponential back-off.
 */
@Injectable()
export class HorizonListenerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(HorizonListenerService.name);
  private abortController: AbortController | null = null;
  private reconnectDelay = 1000; // ms, doubles on each failure up to 30 s

  constructor(
    @InjectQueue(WEBHOOK_QUEUE_NAME) private readonly webhookQueue: Queue,
  ) {}

  onApplicationBootstrap() {
    const contracts = this.contractAddresses();
    if (contracts.length === 0) {
      this.logger.warn('No contract addresses configured — Horizon listener disabled');
      return;
    }
    this.startStream(contracts);
  }

  onApplicationShutdown() {
    this.abortController?.abort();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private contractAddresses(): string[] {
    return [
      process.env.CARBON_REGISTRY_CONTRACT_ID,
      process.env.CARBON_CREDIT_CONTRACT_ID,
      process.env.CARBON_MARKETPLACE_CONTRACT_ID,
      process.env.CARBON_ORACLE_CONTRACT_ID,
    ].filter(Boolean) as string[];
  }

  private async startStream(contracts: string[]) {
    this.abortController = new AbortController();
    const horizonUrl = process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';

    // Horizon /events endpoint supports filtering by contract_id (comma-separated)
    const url = `${horizonUrl}/events?contract_id=${contracts.join(',')}&cursor=now`;

    this.logger.log(`Subscribing to Horizon event stream: ${url}`);

    try {
      const response = await fetch(url, {
        headers: { Accept: 'text/event-stream' },
        signal: this.abortController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Horizon stream responded with ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            await this.handleRawEvent(line.slice(5).trim());
          }
        }
      }

      // Stream ended cleanly — reconnect
      this.scheduleReconnect(contracts);
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // intentional shutdown
      this.logger.error(`Horizon stream error: ${err.message}`);
      this.scheduleReconnect(contracts);
    }
  }

  private scheduleReconnect(contracts: string[]) {
    this.logger.warn(`Reconnecting in ${this.reconnectDelay}ms…`);
    setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
      this.startStream(contracts);
    }, this.reconnectDelay);
  }

  private async handleRawEvent(data: string) {
    let raw: any;
    try {
      raw = JSON.parse(data);
    } catch {
      return; // ignore non-JSON lines (heartbeats etc.)
    }

    const event = this.parseHorizonEvent(raw);
    if (!event) return;

    this.reconnectDelay = 1000; // reset back-off on successful event

    await this.webhookQueue.add('horizon_event', event, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: false,
      removeOnFail: false,   // dead-letter: failed jobs remain queryable
    });

    this.logger.log(`Queued ${event.type} from contract ${event.contractId} ledger ${event.ledger}`);
  }

  private parseHorizonEvent(raw: any): HorizonEvent | null {
    try {
      const topics: string[] = raw.topic ?? [];
      const contractId: string = raw.contract_id ?? '';
      const txHash: string = raw.transaction_hash ?? '';
      const ledger: number = raw.ledger ?? 0;
      const value = raw.value ?? {};

      // Map Soroban event topic symbols to our domain event types
      const topicStr = topics.join(',');
      let type: HorizonEvent['type'] | null = null;

      if (topicStr.includes('minted'))          type = 'credit_minted';
      else if (topicStr.includes('retired'))     type = 'credit_retired';
      else if (topicStr.includes('verified'))    type = 'project_verified';

      if (!type) return null;

      return { type, contractId, ledger, txHash, payload: value };
    } catch {
      return null;
    }
  }
}
