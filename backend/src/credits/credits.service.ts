import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { MintCreditsDto, RetireCreditsDto } from "./credits.dto";
import { randomBytes } from "crypto";
import { EventSourcingService } from "../events/event-sourcing.service";
import { CreditEventType } from "../events/credit-event.types";

@Injectable()
export class CreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventSourcing: EventSourcingService,
  ) {}

  async mintCredits(dto: MintCreditsDto, actor?: string) {
    const existing = await this.prisma.creditBatch.findUnique({ where: { batchId: dto.batchId } });
    if (existing) throw new BadRequestException(`Batch ${dto.batchId} already exists`);

    // Check serial range overlap
    const overlap = await this.prisma.creditBatch.findFirst({
      where: {
        OR: [
          { serialStart: { lte: dto.serialEnd }, serialEnd: { gte: dto.serialStart } },
        ],
      },
    });
    if (overlap) throw new BadRequestException("Serial number range overlaps existing batch — double counting prevented");

    const batch = await this.prisma.creditBatch.create({ data: dto });

    // Record mint event
    await this.eventSourcing.recordEvent({
      creditBatchId: batch.batchId,
      eventType:     CreditEventType.MINT,
      actor:         actor ?? dto.projectId,
      oldState:      null,
      newState: {
        batchId:     batch.batchId,
        projectId:   batch.projectId,
        vintageYear: batch.vintageYear,
        amount:      batch.amount,
        serialStart: batch.serialStart,
        serialEnd:   batch.serialEnd,
        status:      batch.status,
        issuedAt:    batch.issuedAt,
      },
      txHash: randomBytes(32).toString("hex"),
    });

    return batch;
  }

  async getBatch(batchId: string) {
    const batch = await this.prisma.creditBatch.findUnique({ where: { batchId } });
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);
    return batch;
  }

  async retireCredits(dto: RetireCreditsDto) {
    const batch = await this.getBatch(dto.batchId);

    if (batch.status === "FullyRetired") {
      throw new BadRequestException("Credits are already fully retired — retirement is irreversible");
    }

    const retirementId = `ret-${dto.batchId}-${Date.now()}`;
    const serialStart  = Number(batch.serialStart);
    const serialNumbers = Array.from({ length: dto.amount }, (_, i) => String(serialStart + i));

    const txHash = randomBytes(32).toString("hex"); // In production: actual Stellar tx hash

    // Create retirement record
    const retirement = await this.prisma.retirementRecord.create({
      data: {
        retirementId,
        batchId:          dto.batchId,
        projectId:        batch.projectId,
        amount:           dto.amount,
        retiredBy:        dto.holderPublicKey,
        beneficiary:      dto.beneficiary,
        retirementReason: dto.retirementReason,
        vintageYear:      batch.vintageYear,
        serialNumbers,
        txHash,
      },
    });

    // Update batch status
    const newStatus = dto.amount >= batch.amount ? "FullyRetired" : "PartiallyRetired";
    await this.prisma.creditBatch.update({
      where: { batchId: dto.batchId },
      data:  { status: newStatus },
    });

    // Update project totals
    await this.prisma.carbonProject.update({
      where: { projectId: batch.projectId },
      data:  { totalCreditsRetired: { increment: dto.amount } },
    });

    // Record retire event
    await this.eventSourcing.recordEvent({
      creditBatchId: dto.batchId,
      eventType:     CreditEventType.RETIRE,
      actor:         dto.holderPublicKey,
      oldState: {
        status: batch.status,
        amount: batch.amount,
      },
      newState: {
        status:          newStatus,
        amount:          batch.amount,
        retiredAmount:   dto.amount,
        retirementId,
        beneficiary:     dto.beneficiary,
        retirementReason: dto.retirementReason,
        serialNumbers,
      },
      txHash,
    });

    return retirement;
  }

  async getRetirement(retirementId: string) {
    const r = await this.prisma.retirementRecord.findUnique({ where: { retirementId } });
    if (!r) throw new NotFoundException(`Retirement ${retirementId} not found`);
    return r;
  }

  async lookupSerial(serial: string) {
    // Check if serial is in a retirement
    const retirement = await this.prisma.retirementRecord.findFirst({
      where: { serialNumbers: { has: serial } },
    });
    if (retirement) return retirement;

    // Otherwise find the batch containing this serial
    const batch = await this.prisma.creditBatch.findFirst({
      where: {
        serialStart: { lte: serial },
        serialEnd:   { gte: serial },
      },
    });
    if (!batch) throw new NotFoundException(`Serial number ${serial} not found`);
    return batch;
  }
}
