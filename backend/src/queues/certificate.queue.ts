import { Queue, Worker, Job } from 'bullmq';
import { generateCertificatePdf } from '../services/certificate.service';
import { getRedisConnection } from '../config/redis';

export interface CertificateJobData {
  certificateId: string;
  userId: string;
  courseId: string;
}

export interface CertificateJobResult {
  certificateId: string;
  fileUrl: string;
}

export const CERTIFICATE_QUEUE_NAME = 'certificate-generation';

let certificateQueue: Queue<CertificateJobData> | null = null;

export function getCertificateQueue(): Queue<CertificateJobData> {
  if (!certificateQueue) {
    certificateQueue = new Queue<CertificateJobData>(CERTIFICATE_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400 },
      },
    });
  }
  return certificateQueue;
}

export async function enqueueCertificateGeneration(
  data: CertificateJobData,
): Promise<Job<CertificateJobData>> {
  const queue = getCertificateQueue();
  return queue.add('generate', data, {
    jobId: `certificate:${data.certificateId}`,
  });
}

export function createCertificateWorker(): Worker<CertificateJobData, CertificateJobResult> {
  return new Worker<CertificateJobData, CertificateJobResult>(
    CERTIFICATE_QUEUE_NAME,
    async (job: Job<CertificateJobData>) => {
      const { certificateId, userId, courseId } = job.data;
      const fileUrl = await generateCertificatePdf({ certificateId, userId, courseId });
      return { certificateId, fileUrl };
    },
    {
      connection: getRedisConnection(),
      concurrency: 4,
    },
  );
}
