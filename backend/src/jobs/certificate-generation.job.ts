import { Queue, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { generateCertificatePdf } from '../services/certificate.service';
import { logger } from '../utils/logger';

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const CERTIFICATE_QUEUE_NAME = 'certificate-generation';

export interface CertificateGenerationJobData {
  certificateId: string;
  userId: string;
  courseId: string;
}

export const certificateGenerationQueue = new Queue<CertificateGenerationJobData>(
  CERTIFICATE_QUEUE_NAME,
  { connection },
);

export async function enqueueCertificateGeneration(
  data: CertificateGenerationJobData,
): Promise<Job<CertificateGenerationJobData>> {
  return certificateGenerationQueue.add('generate', data, {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

export function createCertificateGenerationWorker(): Worker<CertificateGenerationJobData> {
  const worker = new Worker<CertificateGenerationJobData>(
    CERTIFICATE_QUEUE_NAME,
    async (job: Job<CertificateGenerationJobData>) => {
      const { certificateId, userId, courseId } = job.data;
      logger.info(
        `Processing certificate generation job ${job.id} for certificate ${certificateId}`,
      );
      await generateCertificatePdf({ certificateId, userId, courseId });
    },
    { connection },
  );

  worker.on('failed', (job, err) => {
    logger.error(
      `Certificate generation job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
    );
  });

  return worker;
}
