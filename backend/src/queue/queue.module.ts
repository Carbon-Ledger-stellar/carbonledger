import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { QueueProcessor } from './queue.processor';
import { AuthModule } from '../auth/auth.module';
import { QUEUE_NAME } from './queue.constants';
import { PrismaService } from '../prisma.service';
import { RetirementsModule } from '../retirements/retirements.module';
import { CertificateProcessor } from '../certificates/certificate.processor';
import { CertificatesModule as RetirementsCertificatesModule } from '../retirements/certificates.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAME }),
    AuthModule,
    forwardRef(() => RetirementsModule),
    CertificatesModule,
  ],
  providers: [QueueService, QueueProcessor, PrismaService],
  controllers: [QueueController],
  exports: [QueueService],
})
export class QueueModule implements OnModuleInit {
  constructor(private readonly certificateProcessor: CertificateProcessor) {}

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
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
