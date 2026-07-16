import { Module } from '@nestjs/common';
import { CertificateService } from './certificate.service';
import { PinataService } from './pinata.service';
import { NotificationService } from './notification.service';
import { CertificateProcessor } from './certificate.processor';

@Module({
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
