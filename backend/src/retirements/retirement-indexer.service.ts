import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { QueueService } from "../queue/queue.service";
import { JobType } from "../queue/queue.constants";

export interface RetirementEvent {
  retirementId: string;
  batchId: string;
  projectId: string;
  amount: number;
  retiredBy: string;
  beneficiary: string;
  retirementReason: string;
  vintageYear: number;
  serialStart: string;
  serialEnd: string;
  txHash: string;
  timestamp: string;
}

@Injectable()
export class RetirementIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetirementIndexerService.name);
  private pollInterval: NodeJS.Timeout | null = null;
  private readonly POLL_MS = 20_000; // poll every 20s → index within 30s of confirmation

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  onModuleInit() {
    this.startPolling();
  }

  onModuleDestroy() {
    this.stopPolling();
  }

  private startPolling() {
    this.logger.log("Retirement indexer started");
    this.pollInterval = setInterval(() => this.poll(), this.POLL_MS);
    // Run immediately on startup
    this.poll().catch((e) => this.logger.error("Initial poll failed", e));
  }

  private stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /** Main poll: fetch unindexed retirement events from Horizon and index them. */
  private async poll() {
    try {
      const events = await this.fetchRetirementEvents();
      for (const event of events) {
        await this.indexRetirement(event);
      }
    } catch (err) {
      this.logger.error("Poll error", err);
    }
  }

  /**
   * Fetch retirement events from Stellar Horizon.
   * Reads contract events for the carbon_credit contract filtered by topic "retire".
   */
  private async fetchRetirementEvents(): Promise<RetirementEvent[]> {
    const contractId = process.env.CARBON_CREDIT_CONTRACT_ID;
    if (!contractId) {
      this.logger.warn("CARBON_CREDIT_CONTRACT_ID not set — skipping poll");
      return [];
    }

    const horizonUrl = process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";
    const url = `${horizonUrl}/contracts/${contractId}/events?limit=200&order=asc`;

    const res = await fetch(url);
    if (!res.ok) {
      this.logger.warn(`Horizon returned ${res.status} for contract events`);
      return [];
    }

    const json = (await res.json()) as { _embedded?: { records?: HorizonEvent[] } };
    const records = json._embedded?.records ?? [];

    return records
      .filter((r) => r.type === "contract" && r.topic?.includes("retire"))
      .map((r) => this.parseHorizonEvent(r))
      .filter((e): e is RetirementEvent => e !== null);
  }

  private parseHorizonEvent(record: HorizonEvent): RetirementEvent | null {
    try {
      const d = record.value as Record<string, unknown>;
      return {
        retirementId: String(d["retirement_id"] ?? record.id),
        batchId: String(d["batch_id"] ?? ""),
        projectId: String(d["project_id"] ?? ""),
        amount: Number(d["amount"] ?? 0),
        retiredBy: String(d["retired_by"] ?? ""),
        beneficiary: String(d["beneficiary"] ?? ""),
        retirementReason: String(d["reason"] ?? ""),
        vintageYear: Number(d["vintage_year"] ?? new Date().getFullYear()),
        serialStart: String(d["serial_start"] ?? ""),
        serialEnd: String(d["serial_end"] ?? ""),
        txHash: record.transaction_hash ?? "",
        timestamp: record.created_at ?? new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Index a single retirement event idempotently.
   * If already indexed, skip. Otherwise persist and trigger certificate generation.
   */
  async indexRetirement(event: RetirementEvent): Promise<void> {
    const existing = await this.prisma.retirementRecord.findUnique({
      where: { retirementId: event.retirementId },
    });

    if (existing) {
      this.logger.debug(`Retirement ${event.retirementId} already indexed — skipping`);
      return;
    }

    await this.prisma.retirementRecord.create({
      data: {
        retirementId: event.retirementId,
        batchId: event.batchId,
        projectId: event.projectId,
        amount: event.amount,
        retiredBy: event.retiredBy,
        beneficiary: event.beneficiary,
        retirementReason: event.retirementReason,
        vintageYear: event.vintageYear,
        serialStart: event.serialStart,
        serialEnd: event.serialEnd,
        serialNumbers: [event.serialStart, event.serialEnd],
        txHash: event.txHash,
        retiredAt: new Date(event.timestamp),
      },
    });

    this.logger.log(`Indexed retirement ${event.retirementId} (tx: ${event.txHash})`);

    // Trigger certificate generation via job queue
    await this.queue.enqueue(JobType.CERTIFICATE_GENERATION, {
      retirementId: event.retirementId,
    });

    this.logger.log(`Certificate generation queued for ${event.retirementId}`);
  }
}

interface HorizonEvent {
  id: string;
  type: string;
  topic?: string[];
  value?: unknown;
  transaction_hash?: string;
  created_at?: string;
}
