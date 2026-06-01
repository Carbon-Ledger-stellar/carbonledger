import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HorizonListenerService } from './horizon.listener';
import { WebhookProcessor } from './webhook.processor';
import { PrismaService } from '../prisma.service';
import { WEBHOOK_QUEUE_NAME } from '../queue/queue.constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: WEBHOOK_QUEUE_NAME }),
  ],
  providers: [HorizonListenerService, WebhookProcessor, PrismaService],
  exports: [HorizonListenerService],
})
export class WebhookModule {}
