import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, forwardRef } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAME, JobType } from './queue.constants';
import { PrismaService } from '../prisma.service';
import { CertificateService } from '../retirements/certificate.service';
import { CertificateProcessor } from '../certificates/certificate.processor';
import { RetirementsService } from '../retirements/retirements.service';
import { processWithTrace } from '../telemetry/tracing';
import { CreditsService } from '../credits/credits.service';

@Processor(QUEUE_NAME)
export class QueueProcessor extends WorkerHost {
  private readonly logger = new Logger(QueueProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly certificateService: CertificateService,
    private readonly certificateProcessor: CertificateProcessor,
    @Inject(forwardRef(() => RetirementsService))
    private readonly retirementsService: RetirementsService,
    @Inject(forwardRef(() => CreditsService))
    private readonly creditsService: CreditsService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    return processWithTrace(QUEUE_NAME, job.name, job.data as Record<string, unknown>, async () => {
      this.logger.log(`Processing job ${job.id} type=${job.name} attempt=${job.attemptsMade + 1}`);
      switch (job.name as JobType) {
        case JobType.CERTIFICATE_GENERATION:
          return this.handleCertificateGeneration(job.data);
        case JobType.IPFS_PINNING:
          return this.handleIpfsPinning(job.data);
        case JobType.ORACLE_SUBMISSION:
          return this.handleOracleSubmission(job.data);
        case JobType.EMAIL_NOTIFICATION:
          return this.handleEmailNotification(job.data);
        case JobType.BULK_RETIREMENT:
          return this.handleBulkRetirement(job.data);
        case JobType.BULK_MINT:
          return this.handleBulkMint(job.data);
        default:
          throw new Error(`Unknown job type: ${job.name}`);
      }
    });
  }

  private async handleCertificateGeneration(data: Record<string, unknown>) {
    const retirementId = data['retirementId'] as string;
    this.logger.log(`Generating certificate for retirement ${retirementId}`);
    try {
      await this.certificateProcessor.processCertificateGeneration(retirementId);
      return { retirementId, status: 'generated_and_pinned' };
    } catch (err: any) {
      this.logger.error(`Failed to generate certificate for ${retirementId}: ${err.message}`);
      throw err;
    }
  }

  private async handleIpfsPinning(data: Record<string, unknown>) {
    this.logger.log(`Pinning to IPFS: ${data['cid']}`);
    // TODO: integrate with Pinata client
    return { cid: data['cid'], status: 'pinned' };
  }

  private async handleOracleSubmission(data: Record<string, unknown>) {
    const { oracleUpdateId, type } = data as { oracleUpdateId: string; type: string };
    this.logger.log(`Submitting oracle data to Soroban type=${type} oracleUpdateId=${oracleUpdateId}`);

    await this.prisma.oracleJob.update({
      where: { id: oracleUpdateId },
      data:  { status: 'pending', attempts: { increment: 1 }, updatedAt: new Date() },
    });

    try {
      // Soroban submission — placeholder until contract IDs are wired
      const txHash = `simulated-${Date.now()}`;

      await this.prisma.oracleJob.update({
        where: { id: oracleUpdateId },
        data:  { status: 'submitted', txHash, lastError: null, updatedAt: new Date() },
      });

      this.logger.log(
        `Oracle submission succeeded oracleUpdateId=${oracleUpdateId} txHash=${txHash} at=${new Date().toISOString()}`,
      );
      return { oracleUpdateId, txHash, status: 'submitted' };
    } catch (err: any) {
      await this.prisma.oracleJob.update({
        where: { id: oracleUpdateId },
        data:  { status: 'failed', lastError: err.message, updatedAt: new Date() },
      });
      throw err; // re-throw so BullMQ retries with exponential backoff
    }
  }

  private async handleEmailNotification(data: Record<string, unknown>) {
    this.logger.log(`Sending email to ${data['to']} template=${data['template']}`);
    // TODO: integrate with email provider
    return { to: data['to'], status: 'sent' };
  }

  private async handleBulkRetirement(data: Record<string, unknown>) {
    this.logger.log(`Processing bulk retirement job with ${Array.isArray(data['items']) ? data['items'].length : 0} items`);
    return this.retirementsService.executeBulkRetirements({
      items: data['items'] as any,
      beneficiary: data['beneficiary'] as string,
      retirementReason: data['retirementReason'] as string,
      retiredBy: data['retiredBy'] as string,
    });
  }

  private async handleBulkMint(data: Record<string, unknown>) {
    this.logger.log(`Processing bulk mint job with ${Array.isArray(data['items']) ? data['items'].length : 0} items`);
    return this.creditsService.executeBulkMintJob(data['items'] as any);
  }
}
