import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MailService } from './mail.service';
import { MailProcessor } from './mail.processor';
import { PdfService } from './pdf.service';
import { MAIL_QUEUE } from './mail.constants';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: MAIL_QUEUE,
    }),
  ],
  providers: [MailService, MailProcessor, PdfService, PrismaService],
  exports: [MailService],
})
export class MailModule {}
