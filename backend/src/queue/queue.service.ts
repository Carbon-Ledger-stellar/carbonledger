import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { QUEUE_NAME, JobType } from './queue.constants';
import { enqueueWithTrace } from '../telemetry/tracing';

@Injectable()
export class QueueService {
  constructor(@InjectQueue(QUEUE_NAME) private readonly queue: Queue) {}

  async enqueue(
    type: JobType,
    payload: Record<string, unknown>,
    options?: { jobId?: string },
  ): Promise<Job> {
    return enqueueWithTrace(QUEUE_NAME, type, payload, (data) => this.queue.add(type, data, {
        jobId: options?.jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: false,
        removeOnFail: false,
      }));
  }

  async getJobStatus(jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;
    const [state, progress] = await Promise.all([job.getState(), job.progress]);
    return { id: job.id, type: job.name, state, progress, data: job.data, failedReason: job.failedReason };
  }

  async getQueueStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);
    return { waiting, active, completed, failed, delayed };
  }
}
