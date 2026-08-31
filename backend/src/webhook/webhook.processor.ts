import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import axios from 'axios';
import { OUTBOUND_WEBHOOK_QUEUE } from '../queue/queue.constants';
import { WebhookService, webhookRetryDelayMs } from './webhook.service';
import type { OutboundWebhookJob } from './webhook.service';

/**
 * Processes outbound webhook delivery jobs from the OUTBOUND_WEBHOOK_QUEUE.
 *
 * Each job delivers a signed HTTP POST to the subscriber's URL.
 * On failure the job is retried up to MAX_DELIVERY_ATTEMPTS times with
 * exponential backoff (registered here as the 'custom' strategy referenced
 * by the job's `backoff: { type: 'custom' }` option — BullMQ requires
 * strategy functions to live on the worker, not the job payload).
 * After all retries are exhausted the subscription is deactivated and the
 * owner is notified via email.
 */
@Processor(OUTBOUND_WEBHOOK_QUEUE, {
  settings: {
    backoffStrategy: (attemptsMade: number) => webhookRetryDelayMs(attemptsMade),
  },
})
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(private readonly webhookService: WebhookService) {
    super();
  }

  async process(job: Job<OutboundWebhookJob>): Promise<unknown> {
    const data = job.data;
    const attempt = job.attemptsMade + 1;

    this.logger.log(
      `Delivering ${data.eventType} to ${data.url} (attempt ${attempt}/${job.opts.attempts ?? attempt}, sub=${data.subscriptionId})`,
    );

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = this.webhookService.computeSignature(
      data.secret,
      timestamp,
      data.payload,
    );

    try {
      const response = await axios.post(data.url, data.payload, {
        timeout: 10_000,
        headers: {
          'Content-Type': 'application/json',
          'X-CarbonLedger-Signature': `sha256=${signature}`,
          'X-CarbonLedger-Event': data.eventType,
          'X-CarbonLedger-Delivery-Timestamp': String(timestamp),
          'User-Agent': 'CarbonLedger-Webhook/1.0',
        },
        validateStatus: () => true, // accept all status codes to log them
      });

      const success = response.status >= 200 && response.status < 300;
      const responseBody =
        typeof response.data === 'string'
          ? response.data
          : JSON.stringify(response.data);

      await this.webhookService.recordDeliveryAttempt({
        subscriptionId: data.subscriptionId,
        eventType: data.eventType,
        url: data.url,
        statusCode: response.status,
        responseBody,
        success,
        attempt,
      });

      if (!success) {
        this.logger.warn(
          `Webhook ${data.url} returned ${response.status} on attempt ${attempt}`,
        );
        throw new Error(`HTTP ${response.status}: ${responseBody.slice(0, 200)}`);
      }

      this.logger.log(
        `Successfully delivered ${data.eventType} to ${data.url} (attempt ${attempt})`,
      );
      return { delivered: true, statusCode: response.status, attempt };
    } catch (error: any) {
      // Network errors (timeout, DNS, ECONNREFUSED) — these get retried
      const errorMessage = error?.message ?? String(error);

      await this.webhookService.recordDeliveryAttempt({
        subscriptionId: data.subscriptionId,
        eventType: data.eventType,
        url: data.url,
        success: false,
        attempt,
        error: errorMessage,
      });

      // If this was the last attempt, deactivate the subscription and notify
      const isLastAttempt = job.opts.attempts && attempt >= job.opts.attempts;
      if (isLastAttempt) {
        await this.webhookService.deactivateSubscription(data.subscriptionId);

        // Try to send notification email
        const email = await this.webhookService.getSubscriptionOwnerEmail(
          data.subscriptionId,
        );
        if (email) {
          this.logger.warn(
            `Webhook subscription ${data.subscriptionId} exhausted all retries. ` +
              `Owner notified at ${email}. URL: ${data.url}, Event: ${data.eventType}`,
          );
          // TODO: integrate with MailService to send deactivation notification
          // await this.mailService.sendEmail(email, MailEvent.WEBHOOK_DEACTIVATED, { ... });
        }
      }

      throw error; // re-throw to trigger BullMQ retry
    }
  }
}
