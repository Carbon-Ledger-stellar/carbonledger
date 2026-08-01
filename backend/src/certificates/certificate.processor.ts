import { Injectable, Logger, forwardRef, Inject, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma.service';
import { CertificateService } from './certificate.service';
import { PinataService } from './pinata.service';
import { NotificationService } from './notification.service';
import { WebhookService } from '../webhook/webhook.service';

@Injectable()
export class CertificateProcessor {
  private readonly logger = new Logger(CertificateProcessor.name);    constructor(
    private readonly prisma: PrismaService,
    private readonly certificateService: CertificateService,
    private readonly pinataService: PinataService,
    private readonly notificationService: NotificationService,
    @Optional() private readonly webhookService?: WebhookService,
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

      // Pin the certificate CONTENT (JSON) first (#600) so its CID is known
      // before the PDF is generated — the PDF embeds this CID as a
      // self-referential link to its own underlying, verifiable data.
      // Content hash is computed from these exact bytes and stored so
      // GET /certificates/:cid/verify can detect tampering later.
      const certificateContent = {
        retirement_id: retirement.retirementId,
        project_id: retirement.projectId,
        batch_id: retirement.batchId,
        beneficiary: retirement.beneficiary,
        amount: retirement.amount.toString(),
        retirement_reason: retirement.retirementReason,
        vintage_year: retirement.vintageYear,
        serial_start: retirement.serialStart,
        serial_end: retirement.serialEnd,
        retired_at: Math.floor(retirement.retiredAt.getTime() / 1000),
        tx_hash: retirement.txHash,
        metadata: {
          projectName: retirement.project.name,
          country: retirement.project.country,
          methodology: retirement.project.methodology,
        },
      };
      const contentBuffer = Buffer.from(JSON.stringify(certificateContent, null, 2));
      const contentHash = createHash('sha256').update(contentBuffer).digest('hex');

      this.logger.log(`Pinning certificate content to IPFS for ${retirementId}...`);
      const { cid: contentCid } = await this.pinataService.uploadFile(
        contentBuffer,
        `certificate-${retirementId}.json`,
        { retirementId, projectId: retirement.projectId, timestamp: new Date().toISOString() },
        'application/json',
      );

      // Generate PDF, embedding the content CID as a self-referential link
      this.logger.log(`Generating PDF for ${retirementId}...`);
      const pdfBuffer = await this.certificateService.generatePdf({
        retirementId: retirement.retirementId,
        beneficiary: retirement.beneficiary,
        amount: Number(retirement.amount),
        projectName: retirement.project.name,
        retirementReason: retirement.retirementReason,
        retiredAt: retirement.retiredAt,
        serialNumbers: retirement.serialNumbers,
        serialStart: retirement.serialStart,
        serialEnd: retirement.serialEnd,
        vintageYear: retirement.vintageYear,
        txHash: retirement.txHash,
        contentCid,
      });

      // Upload the PDF itself to IPFS
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
      await this.prisma.retirementRecord.update({
        where: { retirementId },
        data: {
          certificateStatus: 'completed',
          certificateCid: cid,
          certificateUrl: url,
          certificateContentCid: contentCid,
          certificateContentHash: contentHash,
          certificateGeneratedAt: new Date(),
        },
      });

      // Create RetirementCertificate record with IPFS CID
      await this.prisma.retirementCertificate.create({
        data: {
          retirementId: retirement.id,
          beneficiary: retirement.beneficiary,
          amount: retirement.amount,
          projectName: retirement.project.name,
          vintageYear: retirement.vintageYear,
          txHash: retirement.txHash,
          ipfsCid: cid,
          publicUrl: url,
        },
      });

      this.logger.log(
        `Certificate generated successfully for ${retirementId}: pdf=${cid} content=${contentCid}`
      );

      // Send notification email
      try {
        await this.notificationService.sendCertificateReady(
          retirement.retiredBy,
          retirementId,
          url,
          Number(retirement.amount)
        );
      } catch (emailError) {
        this.logger.warn(
          `Failed to send notification email: ${emailError instanceof Error ? emailError.message : String(emailError)}`,
        );
        // Don't fail the job if email fails
      }

      // Dispatch webhook: certificate.ready
      try {
        if (this.webhookService) {
          await this.webhookService.dispatch('certificate.ready', {
            retirementId: retirement.retirementId,
            beneficiary: retirement.beneficiary,
            amount: Number(retirement.amount),
            projectName: retirement.project.name,
            vintageYear: retirement.vintageYear,
            txHash: retirement.txHash,
            certificateUrl: url,
            certificateCid: cid,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (webhookError) {
        this.logger.warn(
          `Failed to dispatch webhook: ${webhookError instanceof Error ? webhookError.message : String(webhookError)}`,
        );
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
              error instanceof Error ? error.message : String(error)
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
