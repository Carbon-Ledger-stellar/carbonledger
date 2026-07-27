import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAME, JobType } from './queue.constants';
import { PrismaService } from '../prisma.service';
import { CertificateService } from '../retirements/certificate.service';

@Processor(QUEUE_NAME)
export class QueueProcessor extends WorkerHost {
  private readonly logger = new Logger(QueueProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly certificateService: CertificateService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
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
      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
  }

  private async handleCertificateGeneration(data: Record<string, unknown>) {
    const retirementId = data['retirementId'] as string;
    this.logger.log(`Generating certificate for retirement ${retirementId}`);
    try {
      const result = await this.certificateService.generateAndPinCertificate(retirementId);
      return { retirementId, cid: result.cid, status: 'generated_and_pinned' };
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

    await this.prisma.oracleUpdate.update({
      where: { id: oracleUpdateId },
      data:  { status: 'pending', attempts: { increment: 1 }, updatedAt: new Date() },
    });

    try {
      // Soroban submission — placeholder until contract IDs are wired
      const txHash = `simulated-${Date.now()}`;

      await this.prisma.oracleUpdate.update({
        where: { id: oracleUpdateId },
        data:  { status: 'submitted', txHash, lastError: null, updatedAt: new Date() },
      });

      this.logger.log(
        `Oracle submission succeeded oracleUpdateId=${oracleUpdateId} txHash=${txHash} at=${new Date().toISOString()}`,
      );
      return { oracleUpdateId, txHash, status: 'submitted' };
    } catch (err: any) {
      await this.prisma.oracleUpdate.update({
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
}
