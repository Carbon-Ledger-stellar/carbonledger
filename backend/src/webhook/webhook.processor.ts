import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma.service';
import { WEBHOOK_QUEUE_NAME } from '../queue/queue.constants';
import { HorizonEvent } from './horizon.listener';

/**
 * Processes HORIZON_EVENT jobs dequeued from the webhook queue.
 *
 * Each handler updates the DB within the BullMQ job retry envelope
 * (3 attempts, exponential back-off). Jobs that exhaust all retries
 * remain in the failed set as a dead-letter queue.
 */
@Processor(WEBHOOK_QUEUE_NAME)
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<HorizonEvent>): Promise<unknown> {
    const event = job.data;
    this.logger.log(`Processing ${event.type} txHash=${event.txHash} attempt=${job.attemptsMade + 1}`);

    switch (event.type) {
      case 'credit_minted':    return this.handleCreditMinted(event);
      case 'credit_retired':   return this.handleCreditRetired(event);
      case 'project_verified': return this.handleProjectVerified(event);
      default:
        this.logger.warn(`Unknown event type: ${(event as any).type}`);
        return null;
    }
  }

  // ── Handlers ───────────────────────────────────────────────────────────────

  private async handleCreditMinted(event: HorizonEvent) {
    const { batch_id, project_id, amount, vintage_year, serial_start, serial_end } = event.payload as any;
    if (!batch_id || !project_id) return;

    await this.prisma.creditBatch.upsert({
      where:  { batchId: String(batch_id) },
      update: { status: 'Active' },
      create: {
        batchId:     String(batch_id),
        projectId:   String(project_id),
        vintageYear: Number(vintage_year ?? 0),
        amount:      Number(amount ?? 0),
        serialStart: String(serial_start ?? ''),
        serialEnd:   String(serial_end ?? ''),
        metadataCid: '',
      },
    });

    // Increment project's totalCreditsIssued
    await this.prisma.carbonProject.updateMany({
      where: { projectId: String(project_id) },
      data:  { totalCreditsIssued: { increment: Number(amount ?? 0) } },
    });

    this.logger.log(`DB updated: credit_minted batch=${batch_id} amount=${amount}`);
    return { batch_id, amount };
  }

  private async handleCreditRetired(event: HorizonEvent) {
    const { retirement_id, batch_id, project_id, amount, retired_by, beneficiary } = event.payload as any;
    if (!retirement_id || !batch_id) return;

    await this.prisma.retirementRecord.upsert({
      where:  { retirementId: String(retirement_id) },
      update: {},
      create: {
        retirementId:     String(retirement_id),
        batchId:          String(batch_id),
        projectId:        String(project_id ?? ''),
        amount:           Number(amount ?? 0),
        retiredBy:        String(retired_by ?? ''),
        beneficiary:      String(beneficiary ?? ''),
        retirementReason: '',
        vintageYear:      0,
        serialNumbers:    [],
        txHash:           event.txHash,
      },
    });

    // Increment project's totalCreditsRetired
    await this.prisma.carbonProject.updateMany({
      where: { projectId: String(project_id) },
      data:  { totalCreditsRetired: { increment: Number(amount ?? 0) } },
    });

    this.logger.log(`DB updated: credit_retired retirement=${retirement_id} amount=${amount}`);
    return { retirement_id, amount };
  }

  private async handleProjectVerified(event: HorizonEvent) {
    const { project_id } = event.payload as any;
    if (!project_id) return;

    await this.prisma.carbonProject.updateMany({
      where: { projectId: String(project_id) },
      data:  { status: 'Verified' },
    });

    this.logger.log(`DB updated: project_verified project=${project_id}`);
    return { project_id };
  }
}
