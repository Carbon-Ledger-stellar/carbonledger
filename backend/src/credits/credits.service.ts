import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { MintCreditsDto, RetireCreditsDto } from "./credits.dto";
import { MailService } from "../mail/mail.service";
import { MailEvent } from "../mail/mail.constants";
import { randomBytes } from "crypto";

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

  async mintCredits(dto: MintCreditsDto) {
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
      throw new BadRequestException("Credits are already fully retired — retirement is irreversible");
    }

    const batchAmount = Number(batch.amount);
    if (dto.amount > batchAmount) {
      throw new BadRequestException(`Cannot retire ${dto.amount} tCO₂e — only ${batchAmount} tCO₂e available`);
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

    return retirement;
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
    if (!batch) throw new NotFoundException(`Serial number ${serial} not found`);
    return batch;
  }
}
