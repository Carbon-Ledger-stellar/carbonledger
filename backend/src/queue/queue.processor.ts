import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAME, JobType } from './queue.constants';
import { PrismaService } from '../prisma.service';
import { CertificateService } from '../retirements/certificate.service';
import { DlqService } from './dlq.service';

/**
 * BullMQ worker for the main "carbonledger" queue.
 *
 * Retry strategy (configured per-job in QueueService.enqueue):
 *   - Maximum 3 attempts
 *   - Exponential backoff starting at 5 s (5 s → 10 s → 20 s)
 *
 * After all retries are exhausted, the onFailed() worker event archives
 * the job to the Dead Letter Queue via DlqService.
 */
@Processor(QUEUE_NAME, {
  // Worker-level concurrency — each instance processes up to 5 jobs in parallel
  concurrency: 5,
})
export class QueueProcessor extends WorkerHost {
  private readonly logger = new Logger(QueueProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly certificateService: CertificateService,
    private readonly dlqService: DlqService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    this.logger.log(
      `Processing job ${job.id} type=${job.name} attempt=${job.attemptsMade + 1}/${job.opts.attempts ?? 1}`,
    );

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

  // ── Worker lifecycle events ──────────────────────────────────────────────────

  /**
   * Invoked by BullMQ after every failed attempt (including non-final ones).
   * When the job has exhausted all retries it is moved to the "failed" state
   * and this handler archives it to the DLQ so no data is silently discarded.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job, error: Error): Promise<void> {
    const maxAttempts = job.opts.attempts ?? 1;
    const isFinal = job.attemptsMade >= maxAttempts;

    this.logger.warn(
      `Job ${job.id} (${job.name}) failed on attempt ${job.attemptsMade}/${maxAttempts}: ${error.message}`,
      { jobId: job.id, jobType: job.name, attempt: job.attemptsMade, final: isFinal },
    );

    if (!isFinal) {
      // Not yet dead-lettered — BullMQ will retry with exponential backoff
      return;
    }

    // All retries exhausted — archive to DLQ
    await this.dlqService.archiveToDlq({
      jobId: String(job.id),
      queueName: QUEUE_NAME,
      jobType: job.name,
      payload: job.data as Record<string, unknown>,
      attempts: job.attemptsMade,
      lastError: error.message,
      errorStack: error.stack,
      enqueuedAt: new Date(job.timestamp),
    });
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job): void {
    this.logger.log(`Job ${job.id} (${job.name}) completed successfully`);
  }

  @OnWorkerEvent('active')
  onActive(job: Job): void {
    this.logger.debug(`Job ${job.id} (${job.name}) is now active`);
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.logger.warn(`Job ${jobId} stalled and has been re-queued`);
  }

  // ── Job handlers ─────────────────────────────────────────────────────────────

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
    this.logger.log(
      `Submitting oracle data to Soroban type=${type} oracleUpdateId=${oracleUpdateId}`,
    );

    await this.prisma.oracleJob.update({
      where: { id: oracleUpdateId },
      data: { status: 'pending', attempts: { increment: 1 }, updatedAt: new Date() },
    });

    try {
      // Soroban submission — placeholder until contract IDs are wired
      const txHash = `simulated-${Date.now()}`;

      await this.prisma.oracleJob.update({
        where: { id: oracleUpdateId },
        data: { status: 'submitted', txHash, lastError: null, updatedAt: new Date() },
      });

      this.logger.log(
        `Oracle submission succeeded oracleUpdateId=${oracleUpdateId} txHash=${txHash} at=${new Date().toISOString()}`,
      );
      return { oracleUpdateId, txHash, status: 'submitted' };
    } catch (err: any) {
      await this.prisma.oracleJob.update({
        where: { id: oracleUpdateId },
        data: { status: 'failed', lastError: err.message, updatedAt: new Date() },
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
