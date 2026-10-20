import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookController } from './webhook.controller';
import { WebhookAdminController } from './webhook-admin.controller';
import { WebhookService } from './webhook.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { Webhook } from './entities/webhook.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { WebhookDeadLetter } from './entities/webhook-dead-letter.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Webhook,
      WebhookDelivery,
      WebhookDeadLetter,
    ]),
  ],
  controllers: [WebhookController, WebhookAdminController],
  providers: [WebhookService, WebhookDeliveryService],
  exports: [WebhookService, WebhookDeliveryService],
})
export class WebhookModule {}
