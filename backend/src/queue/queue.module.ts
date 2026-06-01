import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { QueueProcessor } from './queue.processor';
import { AuthModule } from '../auth/auth.module';
import { CertificatesModule } from '../certificates/certificates.module';
import { QUEUE_NAME } from './queue.constants';
import { PrismaService } from '../prisma.service';
import { CertificatesModule } from '../retirements/certificates.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAME }),
    AuthModule,
    CertificatesModule,
  ],
  providers: [QueueService, QueueProcessor, PrismaService],
  controllers: [QueueController],
  exports: [QueueService],
})
export class QueueModule implements OnModuleInit {
  constructor(private readonly certificateProcessor: CertificateProcessor) {}

  async onModuleInit() {
    // Start polling for pending certificates every 60 seconds
    setInterval(async () => {
      try {
        await this.certificateProcessor.pollPendingCertificates();
      } catch (error) {
        console.error('Certificate polling error:', error);
      }
    }, 60000); // 60 seconds

    // Run initial poll on startup
    try {
      await this.certificateProcessor.pollPendingCertificates();
    } catch (error) {
      console.error('Initial certificate poll failed:', error);
    }
  }
}
