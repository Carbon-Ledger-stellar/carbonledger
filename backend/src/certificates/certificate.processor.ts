import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CertificateService } from './certificate.service';
import { PinataService } from './pinata.service';
import { NotificationService } from './notification.service';

@Injectable()
export class CertificateProcessor {
  private readonly logger = new Logger(CertificateProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly certificateService: CertificateService,
    private readonly pinataService: PinataService,
    private readonly notificationService: NotificationService
  ) {}

  async processCertificateGeneration(retirementId: string): Promise<void> {
    try {
      this.logger.log(`Processing certificate for retirement ${retirementId}`);

      // Fetch retirement record
      const retirement = await this.prisma.retirementRecord.findUnique({
        where: { retirementId },
        include: {
          project: true,
          batch: true,
        },
      });

      if (!retirement) {
        throw new Error(`Retirement ${retirementId} not found`);
      }

      // Update status to generating
      await this.prisma.retirementRecord.update({
        where: { retirementId },
        data: { certificateStatus: 'generating' },
      });

      // Generate PDF
      this.logger.log(`Generating PDF for ${retirementId}...`);
      const pdfBuffer = await this.certificateService.generatePdf({
        retirementId: retirement.retirementId,
        beneficiary: retirement.beneficiary,
        amount: retirement.amount,
        projectName: retirement.project.name,
        retirementReason: retirement.retirementReason,
        retiredAt: retirement.retiredAt,
        serialNumbers: retirement.serialNumbers,
        vintageYear: retirement.vintageYear,
      });

      // Upload to IPFS
      this.logger.log(`Uploading PDF to IPFS for ${retirementId}...`);
      const { cid, url } = await this.pinataService.uploadFile(
        pdfBuffer,
        `certificate-${retirementId}.pdf`,
        {
          retirementId,
          projectId: retirement.projectId,
          timestamp: new Date().toISOString(),
        }
      );

      // Update retirement record with certificate details
      const updated = await this.prisma.retirementRecord.update({
        where: { retirementId },
        data: {
          certificateStatus: 'completed',
          certificateCid: cid,
          certificateUrl: url,
          certificateGeneratedAt: new Date(),
        },
      });

      this.logger.log(
        `Certificate generated successfully for ${retirementId}: ${cid}`
      );

      // Send notification email
      try {
        await this.notificationService.sendCertificateReady(
          retirement.retiredBy,
          retirementId,
          url,
          retirement.amount
        );
      } catch (emailError) {
        this.logger.warn(
          `Failed to send notification email: ${emailError}`,
          emailError
        );
        // Don't fail the job if email fails
      }
    } catch (error) {
      this.logger.error(
        `Certificate generation failed for ${retirementId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : new Error(String(error))
      );

      // Increment retry counter
      const retirement = await this.prisma.retirementRecord.findUnique({
        where: { retirementId },
      });

      if (retirement) {
        const newRetries = retirement.certificateRetries + 1;
        const maxRetries = 3;

        if (newRetries >= maxRetries) {
          // Mark as failed
          await this.prisma.retirementRecord.update({
            where: { retirementId },
            data: {
              certificateStatus: 'failed',
              certificateRetries: newRetries,
              certificateFailedAt: new Date(),
            },
          });

          this.logger.error(
            `Certificate generation failed after ${maxRetries} attempts for ${retirementId}`
          );

          // Send failure notification
          try {
            await this.notificationService.sendCertificateFailed(
              retirement.retiredBy,
              retirementId,
              error.message
            );
          } catch (emailError) {
            this.logger.warn(
              `Failed to send failure notification: ${emailError}`
            );
          }
        } else {
          // Retry
          await this.prisma.retirementRecord.update({
            where: { retirementId },
            data: {
              certificateStatus: 'pending_certificate',
              certificateRetries: newRetries,
            },
          });

          this.logger.log(
            `Retrying certificate generation (${newRetries}/${maxRetries}) for ${retirementId}`
          );
        }
      }

      throw error;
    }
  }

  async pollPendingCertificates(): Promise<void> {
    try {
      this.logger.log('Polling for pending certificates...');

      const pending = await this.prisma.retirementRecord.findMany({
        where: {
          certificateStatus: 'pending_certificate',
        },
        take: 10, // Process max 10 at a time
      });

      this.logger.log(`Found ${pending.length} pending certificates`);

      for (const retirement of pending) {
        try {
          await this.processCertificateGeneration(retirement.retirementId);
        } catch (error) {
          this.logger.error(
            `Error processing ${retirement.retirementId}: ${error}`
          );
          // Continue with next retirement
        }
      }
    } catch (error) {
      this.logger.error(`Polling failed: ${error}`, error);
    }
  }
}
