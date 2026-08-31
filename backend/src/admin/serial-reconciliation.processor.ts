import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  SerialReconciliationService,
  SERIAL_RECONCILIATION_QUEUE,
  SERIAL_RECONCILIATION_JOB,
  ReconciliationReport,
} from './serial-reconciliation.service';

@Processor(SERIAL_RECONCILIATION_QUEUE)
export class SerialReconciliationProcessor extends WorkerHost {
  private readonly logger = new Logger(SerialReconciliationProcessor.name);

  constructor(private readonly reconciliationService: SerialReconciliationService) {
    super();
  }

  async process(job: Job): Promise<ReconciliationReport> {
    if (job.name !== SERIAL_RECONCILIATION_JOB) {
      this.logger.warn(`Unknown job name: ${job.name}`);
      throw new Error(`Unknown job: ${job.name}`);
    }

    this.logger.log(`Processing serial reconciliation job ${job.id}`);

    const report = await this.reconciliationService.runReconciliation(
      async (pct: number) => { await job.updateProgress(pct); },
    );

    this.logger.log(
      `Serial reconciliation job ${job.id} complete — ${report.discrepanciesFound} discrepancies`,
    );
    return report;
  }
}
