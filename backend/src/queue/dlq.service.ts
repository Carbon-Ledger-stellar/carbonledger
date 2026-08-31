import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma.service';
import { QUEUE_NAME, JobType } from './queue.constants';

/**
 * DeadLetterQueueService — persists failed BullMQ jobs to the DLQ table
 * and provides admin-level requeueing.
 *
 * A job lands in the DLQ when it has exhausted all retry attempts
 * (i.e. BullMQ moves it to the "failed" state and emits the "failed" event).
 *
 * Requeueing:
 *  - Marks the DLQ entry as requeued
 *  - Re-enqueues the original payload with fresh retry settings
 *  - Does NOT remove the DLQ record (audit trail preserved)
 */
@Injectable()
export class DlqService {
  private readonly logger = new Logger(DlqService.name);

  constructor(
    @InjectQueue(QUEUE_NAME) private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Persist a failed job to the DLQ table.
   * Called automatically by QueueProcessor.onFailed() after all retries are
   * exhausted (job.attemptsMade >= job.opts.attempts).
   */
  async archiveToDlq(params: {
    jobId: string;
    queueName: string;
    jobType: string;
    payload: Record<string, unknown>;
    attempts: number;
    lastError: string;
    errorStack?: string;
    enqueuedAt: Date;
  }): Promise<void> {
    try {
      await this.prisma.deadLetterJob.upsert({
        where: { jobId: params.jobId },
        update: {
          attempts: params.attempts,
          lastError: params.lastError,
          errorStack: params.errorStack ?? null,
          failedAt: new Date(),
          requeued: false,
          requeuedAt: null,
        },
        create: {
          jobId: params.jobId,
          queueName: params.queueName,
          jobType: params.jobType,
          payload: params.payload,
          attempts: params.attempts,
          lastError: params.lastError,
          errorStack: params.errorStack ?? null,
          enqueuedAt: params.enqueuedAt,
        },
      });

      this.logger.warn(
        `Job ${params.jobId} (${params.jobType}) archived to DLQ after ${params.attempts} attempts`,
        { jobId: params.jobId, jobType: params.jobType, lastError: params.lastError },
      );
    } catch (err: any) {
      // Never throw from the DLQ handler — log and continue
      this.logger.error(
        `Failed to archive job ${params.jobId} to DLQ: ${err.message}`,
        err.stack,
      );
    }
  }

  /**
   * Requeue a single DLQ entry by its database record ID.
   * Returns the new BullMQ job ID so callers can track the requeued job.
   */
  async requeueById(dlqId: string): Promise<{ newJobId: string; dlqId: string }> {
    const record = await this.prisma.deadLetterJob.findUnique({ where: { id: dlqId } });
    if (!record) {
      throw new Error(`DLQ record not found: ${dlqId}`);
    }
    if (record.requeued) {
      throw new Error(`DLQ record ${dlqId} has already been requeued`);
    }

    const newJob = await this.queue.add(
      record.jobType as JobType,
      record.payload as Record<string, unknown>,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    await this.prisma.deadLetterJob.update({
      where: { id: dlqId },
      data: { requeued: true, requeuedAt: new Date() },
    });

    this.logger.log(
      `DLQ record ${dlqId} requeued as job ${newJob.id} (type=${record.jobType})`,
    );

    return { newJobId: String(newJob.id), dlqId };
  }

  /**
   * Requeue all non-requeued DLQ entries, optionally filtered by job type.
   */
  async requeueAll(jobType?: string): Promise<{ requeued: number; errors: string[] }> {
    const records = await this.prisma.deadLetterJob.findMany({
      where: {
        requeued: false,
        ...(jobType ? { jobType } : {}),
      },
    });

    let requeued = 0;
    const errors: string[] = [];

    for (const record of records) {
      try {
        await this.requeueById(record.id);
        requeued++;
      } catch (err: any) {
        errors.push(`${record.id}: ${err.message}`);
      }
    }

    this.logger.log(`Bulk requeue complete: ${requeued} jobs requeued, ${errors.length} errors`);
    return { requeued, errors };
  }

  /**
   * List DLQ entries, optionally filtered and paginated.
   */
  async list(params: {
    queueName?: string;
    jobType?: string;
    requeued?: boolean;
    limit?: number;
    offset?: number;
  }) {
    return this.prisma.deadLetterJob.findMany({
      where: {
        ...(params.queueName ? { queueName: params.queueName } : {}),
        ...(params.jobType ? { jobType: params.jobType } : {}),
        ...(params.requeued !== undefined ? { requeued: params.requeued } : {}),
      },
      orderBy: { failedAt: 'desc' },
      take: params.limit ?? 50,
      skip: params.offset ?? 0,
    });
  }

  /**
   * Count pending (non-requeued) DLQ entries.
   */
  async countPending(): Promise<number> {
    return this.prisma.deadLetterJob.count({ where: { requeued: false } });
  }
}
