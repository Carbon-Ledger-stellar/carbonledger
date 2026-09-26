import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HorizonListenerService } from './horizon.listener';
import { HorizonEventProcessor } from './horizon-event.processor';
import { WebhookProcessor } from './webhook.processor';
import { WebhookService } from './webhook.service';
import { WebhookController } from './webhook.controller';
import { PrismaService } from '../prisma.service';
import { WEBHOOK_QUEUE_NAME, OUTBOUND_WEBHOOK_QUEUE } from '../queue/queue.constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: WEBHOOK_QUEUE_NAME }),
    BullModule.registerQueue({ name: OUTBOUND_WEBHOOK_QUEUE }),
  ],
  controllers: [WebhookController],
  providers: [
    HorizonListenerService,
    HorizonEventProcessor,
    WebhookProcessor,
    WebhookService,
    PrismaService,
  ],
  exports: [HorizonListenerService, WebhookService],
})
export class WebhookModule {}
