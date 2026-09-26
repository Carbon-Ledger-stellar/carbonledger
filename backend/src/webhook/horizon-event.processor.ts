import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WEBHOOK_QUEUE_NAME } from '../queue/queue.constants';
import { WebhookService } from './webhook.service';
import type { HorizonEvent } from './horizon.listener';
import type { WebhookEvent } from './webhook.dto';
import { processWithTrace } from '../telemetry/tracing';

/**
 * Maps inbound on-chain Horizon events to outbound webhook event types.
 *
 * `credit_retired` is intentionally omitted: retirements.service.ts already
 * dispatches `retirement.confirmed` directly once a retirement is recorded
 * in the database, so mapping it here too would double-deliver. Types with
 * no outbound mapping (credit_minted, project_verified) are ignored.
 */
const HORIZON_TO_OUTBOUND_EVENT: Partial<Record<HorizonEvent['type'], WebhookEvent>> = {
  monitoring_data_submitted: 'monitoring.data_submitted',
  price_updated: 'oracle.price_updated',
};

/**
 * Bridges inbound Soroban contract events (queued by HorizonListenerService)
 * to outbound webhook deliveries for corporate subscribers — specifically
 * "monitoring data submitted" and "oracle price updated" (#595).
 */
@Processor(WEBHOOK_QUEUE_NAME)
export class HorizonEventProcessor extends WorkerHost {
  private readonly logger = new Logger(HorizonEventProcessor.name);

  constructor(private readonly webhookService: WebhookService) {
    super();
  }

  async process(job: Job<HorizonEvent>): Promise<unknown> {
    return processWithTrace(WEBHOOK_QUEUE_NAME, job.name, job.data as Record<string, unknown>, async () => {
      const event = job.data;
      const outboundEvent = HORIZON_TO_OUTBOUND_EVENT[event.type];

      if (!outboundEvent) {
        this.logger.debug(`No outbound mapping for horizon event ${event.type} — skipping`);
        return { dispatched: false };
      }

    await this.webhookService.dispatch(outboundEvent, {
      contractId: event.contractId,
      ledger: event.ledger,
      txHash: event.txHash,
      ...event.payload,
    });

      return { dispatched: true, outboundEvent };
    });
  }
}
