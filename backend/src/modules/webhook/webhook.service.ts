import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Webhook } from './entities/webhook.entity';
import { WebhookDelivery, WebhookDeliveryStatus } from './entities/webhook-delivery.entity';

const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 5 * 60 * 1000;

export interface WebhookPayload {
  event: string;
  data: unknown;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @InjectRepository(Webhook)
    private readonly webhookRepository: Repository<Webhook>,
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepository: Repository<WebhookDelivery>,
  ) {}

  async dispatch(webhookId: string, payload: WebhookPayload): Promise<WebhookDelivery> {
    const webhook = await this.webhookRepository.findOne({ where: { id: webhookId } });
    if (!webhook) {
      throw new NotFoundException(`Webhook ${webhookId} not found`);
    }

    const delivery = this.deliveryRepository.create({
      webhookId,
      payload,
      attempts: 0,
      status: WebhookDeliveryStatus.PENDING,
      nextAttemptAt: new Date(),
    });
    const saved = await this.deliveryRepository.save(delivery);

    await this.attemptDelivery(saved);
    return saved;
  }

  private async attemptDelivery(delivery: WebhookDelivery): Promise<void> {
    const webhook = await this.webhookRepository.findOne({ where: { id: delivery.webhookId } });
    if (!webhook) {
      delivery.status = WebhookDeliveryStatus.DEAD_LETTER;
      delivery.lastError = 'Webhook no longer exists';
      await this.deliveryRepository.save(delivery);
      return;
    }

    delivery.attempts += 1;

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(webhook.secret ? { 'X-Webhook-Secret': webhook.secret } : {}),
        },
        body: JSON.stringify(delivery.payload),
      });

      if (!response.ok) {
        throw new Error(`Webhook responded with status ${response.status}`);
      }

      delivery.status = WebhookDeliveryStatus.DELIVERED;
      delivery.lastError = null;
      delivery.nextAttemptAt = null;
      delivery.deliveredAt = new Date();
      await this.deliveryRepository.save(delivery);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      delivery.lastError = message;

      if (delivery.attempts >= MAX_ATTEMPTS) {
        delivery.status = WebhookDeliveryStatus.DEAD_LETTER;
        delivery.nextAttemptAt = null;
        this.logger.warn(
          `Webhook delivery ${delivery.id} moved to dead-letter after ${delivery.attempts} attempts: ${message}`,
        );
      } else {
        delivery.status = WebhookDeliveryStatus.RETRYING;
        delivery.nextAttemptAt = new Date(Date.now() + this.computeBackoff(delivery.attempts));
        this.logger.warn(
          `Webhook delivery ${delivery.id} failed (attempt ${delivery.attempts}/${MAX_ATTEMPTS}), retrying at ${delivery.nextAttemptAt.toISOString()}: ${message}`,
        );
      }

      await this.deliveryRepository.save(delivery);
    }
  }

  private computeBackoff(attempt: number): number {
    const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
    return Math.min(delay, MAX_DELAY_MS);
  }

  async processDueRetries(): Promise<void> {
    const due = await this.deliveryRepository
      .createQueryBuilder('delivery')
      .where('delivery.status = :status', { status: WebhookDeliveryStatus.RETRYING })
      .andWhere('delivery.nextAttemptAt <= :now', { now: new Date() })
      .getMany();

    for (const delivery of due) {
      await this.attemptDelivery(delivery);
    }
  }

  async listDeadLetters(): Promise<WebhookDelivery[]> {
    return this.deliveryRepository.find({
      where: { status: WebhookDeliveryStatus.DEAD_LETTER },
      order: { updatedAt: 'DESC' },
    });
  }

  async replayDeadLetter(deliveryId: string): Promise<WebhookDelivery> {
    const delivery = await this.deliveryRepository.findOne({ where: { id: deliveryId } });
    if (!delivery) {
      throw new NotFoundException(`Webhook delivery ${deliveryId} not found`);
    }
    if (delivery.status !== WebhookDeliveryStatus.DEAD_LETTER) {
      throw new NotFoundException(`Webhook delivery ${deliveryId} is not dead-lettered`);
    }

    delivery.status = WebhookDeliveryStatus.PENDING;
    delivery.attempts = 0;
    delivery.lastError = null;
    delivery.nextAttemptAt = new Date();
    await this.deliveryRepository.save(delivery);

    await this.attemptDelivery(delivery);
    return delivery;
  }
}
