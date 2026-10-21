import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ContractStateSyncService } from './contract-state-sync.service';
import { PauseAlertService } from './pause-alert.service';
import { PrismaService } from '../prisma.service';
import { MailModule } from '../mail/mail.module';
import { WebhookModule } from '../webhook/webhook.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    MailModule,
    WebhookModule,
  ],
  providers: [ContractStateSyncService, PauseAlertService, PrismaService],
  exports: [ContractStateSyncService, PauseAlertService],
})
export class ContractSyncModule {}
