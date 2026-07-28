import { Module } from '@nestjs/common';
import { CertificateService } from './certificate.service';
import { PinataService } from './pinata.service';
import { NotificationService } from './notification.service';
import { CertificateProcessor } from './certificate.processor';
import { CertificatesController } from './certificates.controller';
import { WebhookModule } from '../webhook/webhook.module';

@Module({
  imports: [WebhookModule],
  controllers: [CertificatesController],
  providers: [
    CertificateService,
    PinataService,
    NotificationService,
    CertificateProcessor,
  ],
  exports: [
    CertificateService,
    PinataService,
    NotificationService,
    CertificateProcessor,
  ],
})
export class CertificatesModule {}
