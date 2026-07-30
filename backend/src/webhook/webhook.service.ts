import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../prisma.service';
import { OUTBOUND_WEBHOOK_QUEUE } from '../queue/queue.constants';
import {
  CreateWebhookSubscriptionDto,
  WebhookEvent,
  WEBHOOK_EVENTS,
} from './webhook.dto';

/**
 * Payload sent to the outbound webhook BullMQ queue for delivery.
 */
export interface OutboundWebhookJob {
  subscriptionId: string;
  url: string;
  secret: string;
  eventType: WebhookEvent;
  payload: Record<string, unknown>;
  attempt: number;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(OUTBOUND_WEBHOOK_QUEUE) private readonly webhookQueue: Queue,
  ) {}

  // ── Private Prisma accessors ─────────────────────────────────────────────

  private get subDb(): any {
    return (this.prisma as any).webhookSubscription;
  }
  private get logDb(): any {
    return (this.prisma as any).webhookDeliveryLog;
  }

  // ── Subscription management ─────────────────────────────────────────────

  /**
   * Register a new webhook subscription.
   *
   * A 32-byte hex secret is generated for HMAC-SHA256 signing.
   * The caller's `ownerAddress` is used to scope subscriptions.
   * Deduplication: creating the same (url, ownerAddress, events) combination
   * reactivates an existing inactive subscription.
   */
  async subscribe(dto: CreateWebhookSubscriptionDto) {
    // Check for existing subscription with same URL and owner
    const existing = await this.subDb.findFirst({
      where: {
        url: dto.url,
        ownerAddress: dto.ownerAddress,
      },
    });

    if (existing) {
      if (existing.active) {
        throw new ConflictException(
          `Webhook subscription for ${dto.url} already exists (id: ${existing.id})`,
        );
      }
      // Reactivate inactive subscription and update events
      const updated = await this.subDb.update({
        where: { id: existing.id },
        data: {
          active: true,
          secret: randomBytes(32).toString('hex'),
          events: dto.events,
        },
      });
      this.logger.log(`Reactivated webhook subscription ${updated.id} → ${dto.url}`);
      return updated;
    }

    const secret = randomBytes(32).toString('hex');
    const sub = await this.subDb.create({
      data: {
        ownerAddress: dto.ownerAddress,
        url: dto.url,
        secret,
        events: dto.events,
        active: dto.active ?? true,
      },
    });

    this.logger.log(`Created webhook subscription ${sub.id} → ${sub.url}`);
    return sub;
  }

  /**
   * Delete (deactivate) a webhook subscription.
   * Subscriptions are never hard-deleted so delivery logs are preserved.
   */
  async unsubscribe(id: string, ownerAddress: string) {
    const sub = await this.findSubscriptionOrThrow(id);

    if (sub.ownerAddress !== ownerAddress) {
      throw new BadRequestException('Cannot unsubscribe: you do not own this subscription');
    }

    const updated = await this.subDb.update({
      where: { id },
      data: { active: false },
    });

    this.logger.log(`Deactivated webhook subscription ${id}`);
    return updated;
  }

  /**
   * List all subscriptions for an owner address.
   */
  async listSubscriptions(ownerAddress: string) {
    return this.subDb.findMany({
      where: { ownerAddress },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a single subscription by ID (scoped to owner).
   */
  async getSubscription(id: string, ownerAddress: string) {
    const sub = await this.findSubscriptionOrThrow(id);
    if (sub.ownerAddress !== ownerAddress) {
      throw new BadRequestException('Access denied');
    }
    return sub;
  }

  // ── Event dispatch ──────────────────────────────────────────────────────

  /**
   * Dispatch a webhook event to all active subscriptions that listen for it.
   *
   * Called from the retirement and certificate flows. Each matching subscription
   * gets a job enqueued into the OUTBOUND_WEBHOOK_QUEUE BullMQ queue.
   */
  async dispatch(eventType: WebhookEvent, payload: Record<string, unknown>) {
    const subscriptions = await this.subDb.findMany({
      where: {
        active: true,
        events: { has: eventType },
      },
    });

    if (subscriptions.length === 0) {
      this.logger.debug(`No active subscriptions for ${eventType}`);
      return;
    }

    this.logger.log(
      `Dispatching ${eventType} to ${subscriptions.length} subscription(s)`,
    );

    // Enqueue all deliveries in parallel
    await Promise.all(
      subscriptions.map((sub) =>
        this.webhookQueue.add(
          'deliver',
          {
            subscriptionId: sub.id,
            url: sub.url,
            secret: sub.secret,
            eventType,
            payload,
            attempt: 1,
          } satisfies OutboundWebhookJob,
          {
            attempts: 3,
            backoff: {
              type: 'custom',
              backoffStrategy: (attemptsMade: number) => {
                // Exponential backoff: attempt 1→2: 30s, attempt 2→3: 5m, after exhaustion: 30m
                const delays = [30_000, 300_000, 1_800_000];
                return delays[attemptsMade - 1] ?? 1_800_000;
              },
            },
          },
        ),
      ),
    );
  }

  // ── Delivery log access ─────────────────────────────────────────────────

  /**
   * Get delivery logs for a subscription, paginated.
   */
  async getDeliveryLogs(
    subscriptionId: string,
    ownerAddress: string,
    page = 1,
    pageSize = 20,
  ) {
    // Verify ownership
    await this.getSubscription(subscriptionId, ownerAddress);

    const skip = (page - 1) * pageSize;
    const [logs, total] = await Promise.all([
      this.logDb.findMany({
        where: { subscriptionId },
        orderBy: { timestamp: 'desc' },
        skip,
        take: pageSize,
      }),
      this.logDb.count({ where: { subscriptionId } }),
    ]);

    return { logs, total, page, pageSize };
  }

  // ── HMAC signing ────────────────────────────────────────────────────────

  /**
   * Compute HMAC-SHA256 signature for a webhook payload.
   *
   * Canonical format: timestamp + '.' + JSON.stringify(payload)
   * The signature is sent as the X-CarbonLedger-Signature header:
   *   sha256=<hex-digest>
   */
  computeSignature(secret: string, timestamp: number, payload: Record<string, unknown>): string {
    const body = `${timestamp}.${JSON.stringify(payload)}`;
    return createHmac('sha256', secret).update(body).digest('hex');
  }

  // ── Processor helpers (called from WebhookProcessor) ───────────────────

  /**
   * Record a delivery attempt in the log.
   */
  async recordDeliveryAttempt(params: {
    subscriptionId: string;
    eventType: string;
    url: string;
    statusCode?: number;
    responseBody?: string;
    success: boolean;
    attempt: number;
    error?: string;
  }) {
    return this.logDb.create({
      data: {
        subscriptionId: params.subscriptionId,
        eventType: params.eventType,
        url: params.url,
        statusCode: params.statusCode ?? null,
        responseBody: params.responseBody
          ? params.responseBody.slice(0, 1000) // truncate to 1000 chars
          : null,
        success: params.success,
        attempt: params.attempt,
        error: params.error ?? null,
      },
    });
  }

  /**
   * Deactivate a subscription after all retries are exhausted.
   */
  async deactivateSubscription(subscriptionId: string) {
    await this.subDb.update({
      where: { id: subscriptionId },
      data: { active: false },
    });
    this.logger.warn(
      `Subscription ${subscriptionId} deactivated after exhausting all retries`,
    );
  }

  /**
   * Get the owner email for a subscription (for notification on deactivation).
   */
  async getSubscriptionOwnerEmail(subscriptionId: string): Promise<string | null> {
    const sub = await this.subDb.findUnique({ where: { id: subscriptionId } });
    if (!sub) return null;

    const user = await this.prisma.user.findUnique({
      where: { publicKey: sub.ownerAddress },
      select: { email: true },
    });
    return user?.email ?? null;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async findSubscriptionOrThrow(id: string) {
    const sub = await this.subDb.findUnique({ where: { id } });
    if (!sub) {
      throw new NotFoundException(`Webhook subscription ${id} not found`);
    }
    return sub;
  }
}
