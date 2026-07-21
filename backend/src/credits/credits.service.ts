import { Injectable, NotFoundException, BadRequestException, ConflictException, UnprocessableEntityException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { MintCreditsDto, RetireCreditsDto } from "./credits.dto";
import { MailService } from "../mail/mail.service";
import { MailEvent } from "../mail/mail.constants";
import { randomBytes } from "crypto";
import { EventSourcingService } from "../events/event-sourcing.service";
import { CreditEventType } from "../events/credit-event.types";

/**
 * Serial numbers are stored as fixed-point integers scaled by 100.
 * 1 tCO₂e = 100 serial units, 0.5 tCO₂e = 50 serial units, 0.01 tCO₂e = 1 serial unit.
 * This allows fractional batches while keeping serial arithmetic in integers.
 */
const SERIAL_SCALE = 100;

function toSerialUnits(tonnes: number): bigint {
  return BigInt(Math.round(tonnes * SERIAL_SCALE));
}

@Injectable()
export class CreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly ipfsService: IpfsService,
  ) {}

  async mintCredits(dto: MintCreditsDto, actor?: string) {
    const existing = await this.prisma.creditBatch.findUnique({ where: { batchId: dto.batchId } });
    if (existing) throw new BadRequestException(`Batch ${dto.batchId} already exists`);

    if (!/^[0-9]+$/.test(dto.serialStart) || !/^[0-9]+$/.test(dto.serialEnd)) {
      throw new BadRequestException("serialStart and serialEnd must be positive integer strings");
    }

    const serialStartUnits = BigInt(dto.serialStart);
    const serialEndUnits = BigInt(dto.serialEnd);
    if (serialStartUnits <= 0n || serialEndUnits <= 0n || serialEndUnits <= serialStartUnits) {
      throw new BadRequestException("serialEnd must be greater than serialStart and both must be positive");
    }

    // Check serial range overlap (prevents double counting)
    const overlap = await this.prisma.creditBatch.findFirst({
      where: {
        OR: [{ serialStart: { lte: dto.serialEnd }, serialEnd: { gte: dto.serialStart } }],
      },
    });
    if (overlap) throw new BadRequestException("Serial number range overlaps existing batch — double counting prevented");

    const batch = await this.prisma.creditBatch.create({ data: dto });

    // Notify project owner (respects per-event preferences)
    const project = await this.prisma.carbonProject.findUnique({ where: { projectId: dto.projectId } });
    if (project?.ownerAddress) {
      await this.mailService.sendIfEnabled(project.ownerAddress, MailEvent.CREDITS_MINTED, {
        batchId: batch.batchId,
        amount: batch.amount,
        vintageYear: batch.vintageYear,
      });
    }

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
      throw new ConflictException("Credits are already fully retired — retirement is irreversible");
    }

    const batchAmount = Number(batch.amount);
    if (dto.amount > batchAmount) {
      throw new UnprocessableEntityException(`Cannot retire ${dto.amount} tCO₂e — only ${batchAmount} tCO₂e available`);
    }

    const retirementId = `ret-${dto.batchId}-${Date.now()}`;

    // Assign serial numbers using fixed-point scaling (0.01 tCO₂e = 1 serial unit)
    const serialStartUnits = BigInt(batch.serialStart);
    const retireUnits = toSerialUnits(dto.amount);
    const serialNumbers = Array.from({ length: Number(retireUnits) }, (_, i) =>
      String(serialStartUnits + BigInt(i)),
    );

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
        txHash:           randomBytes(32).toString("hex"),
        isValid:          true,
      },
    });

    const newStatus = dto.amount >= batchAmount ? "FullyRetired" : "PartiallyRetired";
    await this.prisma.creditBatch.update({
      where: { batchId: dto.batchId },
      data:  { status: newStatus },
    });

    await this.prisma.carbonProject.update({
      where: { projectId: batch.projectId },
      data:  { totalCreditsRetired: { increment: dto.amount } },
    });

    // Notify holder (respects per-event preferences)
    await this.mailService.sendIfEnabled(dto.holderPublicKey, MailEvent.RETIREMENT_CONFIRMED, {
      retirementId: retirement.retirementId,
      beneficiary: retirement.beneficiary,
      amount: retirement.amount,
    });

    return {
      ...retirement,
      certificateUrl: retirement.certificateCid 
        ? `https://gateway.pinata.cloud/ipfs/${retirement.certificateCid}` 
        : null
    };
  }

  async getRetirement(retirementId: string) {
    const r = await this.prisma.retirementRecord.findUnique({ where: { retirementId } });
    if (!r) throw new NotFoundException(`Retirement ${retirementId} not found`);
    return r;
  }

  async lookupSerial(serial: string) {
    const retirement = await this.prisma.retirementRecord.findFirst({
      where: { serialNumbers: { has: serial } },
    });
    if (retirement) return retirement;

    const batch = await this.prisma.creditBatch.findFirst({
      where: { serialStart: { lte: serial }, serialEnd: { gte: serial } },
    });
    if (!batch) throw new NotFoundException('Credit not found');
    return batch;
  }

  /**
   * Full provenance lookup for a single serial number.
   *
   * Returns the minting batch, the associated project details, all transfer
   * events in chronological order, and retirement details if the credit has
   * been retired.  The endpoint is public — no authentication required.
   *
   * Returns 404 when the serial number does not belong to any known batch.
   */
  async getSerialProvenance(serial: string) {
    // 1. Locate the credit batch that owns this serial number
    const batch = await this.prisma.creditBatch.findFirst({
      where: { serialStart: { lte: serial }, serialEnd: { gte: serial } },
      include: {
        project: {
          select: {
            projectId:    true,
            name:         true,
            methodology:  true,
            country:      true,
            vintageYear:  true,
            ownerAddress: true,
          },
        },
      },
    });

    if (!batch) {
      throw new NotFoundException(
        `Serial number ${serial} does not belong to any known credit batch`,
      );
    }

    // 2. Determine current owner and retirement status
    //    Ownership is tracked through the event log (transfer events) and,
    //    as a fallback, falls back to the project owner address.
    const retirement = await this.prisma.retirementRecord.findFirst({
      where: { serialNumbers: { has: serial } },
      select: {
        retirementId:     true,
        retiredBy:        true,
        beneficiary:      true,
        retirementReason: true,
        vintageYear:      true,
        txHash:           true,
        retiredAt:        true,
        certificateCid:   true,
      },
    });

    // 3. Fetch all CreditEvents for this batch (transfer / mint / retire) in
    //    chronological order.  These come from the append-only event log.
    const rawEvents: Array<{
      id: string;
      creditBatchId: string;
      eventType: string;
      actor: string;
      oldState: unknown;
      newState: unknown;
      timestamp: Date;
      txHash: string;
    }> = await (this.prisma as any).creditEvent.findMany({
      where:   { creditBatchId: batch.batchId },
      orderBy: { timestamp: 'asc' },
      select: {
        id:           true,
        creditBatchId:true,
        eventType:    true,
        actor:        true,
        oldState:     true,
        newState:     true,
        timestamp:    true,
        txHash:       true,
      },
    });

    // 4. Derive current owner from the latest transfer event, or fall back to
    //    the project's ownerAddress when no transfer events exist.
    const transferEvents = rawEvents.filter((e) => e.eventType === 'transfer');
    const lastTransfer   = transferEvents[transferEvents.length - 1] as
      | (typeof transferEvents[0] & { newState: { to?: string } | null })
      | undefined;

    const currentOwner = retirement
      ? null // retired — no current owner
      : (lastTransfer?.newState as { to?: string } | null)?.to
          ?? batch.project.ownerAddress;

    // 5. Compose the provenance response
    return {
      serialNumber: serial,

      batch: {
        batchId:     batch.batchId,
        vintageYear: batch.vintageYear,
        amount:      batch.amount,
        serialStart: batch.serialStart,
        serialEnd:   batch.serialEnd,
        status:      batch.status,
        issuedAt:    batch.issuedAt,
        metadataCid: batch.metadataCid,
      },

      project: {
        projectId:   batch.project.projectId,
        name:        batch.project.name,
        methodology: batch.project.methodology,
        country:     batch.project.country,
        vintageYear: batch.project.vintageYear,
      },

      currentOwner,

      status: retirement ? 'retired' : 'active',

      // All transfer events in chronological order
      transfers: transferEvents.map((e) => ({
        eventType: e.eventType,
        actor:     e.actor,
        from:      (e.oldState as { owner?: string } | null)?.owner ?? null,
        to:        (e.newState as { to?: string }   | null)?.to   ?? null,
        txHash:    e.txHash,
        timestamp: e.timestamp,
      })),

      // All events in full (for audit purposes)
      provenance: rawEvents.map((e) => ({
        eventType: e.eventType,
        actor:     e.actor,
        txHash:    e.txHash,
        timestamp: e.timestamp,
      })),

      // Only present when the credit has been retired
      retirement: retirement
        ? {
            retirementId:     retirement.retirementId,
            retiredBy:        retirement.retiredBy,
            beneficiary:      retirement.beneficiary,
            retirementReason: retirement.retirementReason,
            vintageYear:      retirement.vintageYear,
            txHash:           retirement.txHash,
            retiredAt:        retirement.retiredAt,
            certificateUrl:   retirement.certificateCid
              ? `https://gateway.pinata.cloud/ipfs/${retirement.certificateCid}`
              : null,
          }
        : null,
    };
  }
}
