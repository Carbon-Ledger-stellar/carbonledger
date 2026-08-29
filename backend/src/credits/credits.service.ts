import { Injectable, NotFoundException, BadRequestException, ConflictException, UnprocessableEntityException, Logger, Inject, forwardRef } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { MintCreditsDto, RetireCreditsDto, BatchOperationResult, BatchItemStatus } from "./credits.dto";
import { MailService } from "../mail/mail.service";
import { MailEvent } from "../mail/mail.constants";
import { IpfsService } from "../common/ipfs.service";
import { randomBytes } from "crypto";
import { EventSourcingService } from "../events/event-sourcing.service";
import { CreditEventType } from "../events/credit-event.types";
import { WebhookService } from "../webhook/webhook.service";
import { QueueService } from "../queue/queue.service";
import { JobType } from "../queue/queue.constants";

/**
 * Serial numbers are stored as fixed-point integers scaled by 100.
 * 1 tCO₂e = 100 serial units, 0.5 tCO₂e = 50 serial units, 0.01 tCO₂e = 1 serial unit.
 * This allows fractional batches while keeping serial arithmetic in integers.
 */
import { Optional } from "@nestjs/common";

const SERIAL_SCALE = 100;

function toSerialUnits(tonnes: number): bigint {
  return BigInt(Math.round(tonnes * SERIAL_SCALE));
}

@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly ipfsService: IpfsService,
    @Optional() private readonly eventSourcing?: EventSourcingService,
    @Optional() private readonly webhookService?: WebhookService,
    @Inject(forwardRef(() => QueueService)) private readonly queueService?: QueueService,
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

    // Record MINT event in event store
    if (this.eventSourcing) {
      await this.eventSourcing.recordEvent({
        creditBatchId: batch.batchId,
        eventType: CreditEventType.MINT,
        actor: actor ?? dto.projectId ?? 'system',
        newState: {
          batchId: batch.batchId,
          projectId: batch.projectId,
          amountAvailable: Number(batch.amount),
          amountRetired: 0,
          status: 'Issued',
          vintageYear: batch.vintageYear,
          serialStart: batch.serialStart,
          serialEnd: batch.serialEnd,
        },
        txHash: (batch as any).txHash ?? 'STUB_MINT_HASH',
      }).catch(() => undefined);
    }

    // Notify project owner (respects per-event preferences)
    const project = await this.prisma.carbonProject.findFirst({ where: { projectId: dto.projectId, deletedAt: null } });
    if (project?.ownerAddress) {
      await this.mailService.sendIfEnabled(project.ownerAddress, MailEvent.CREDITS_MINTED, {
        batchId: batch.batchId,
        amount: batch.amount,
        vintageYear: batch.vintageYear,
      });
    }

    // Dispatch webhook: credits.minted
    try {
      if (this.webhookService) {
        await this.webhookService.dispatch('credits.minted', {
          batchId: batch.batchId,
          projectId: batch.projectId,
          amount: Number(batch.amount),
          vintageYear: batch.vintageYear,
          serialStart: batch.serialStart,
          serialEnd: batch.serialEnd,
          methodology: batch.methodology,
          country: batch.country,
          txHash: (batch as any).txHash ?? 'STUB_MINT_HASH',
          timestamp: new Date().toISOString(),
        });
      }
    } catch (webhookError) {
      this.logger.warn(`Failed to dispatch webhook: ${webhookError instanceof Error ? webhookError.message : String(webhookError)}`);
    }

    return batch;
  }

  async bulkMintCredits(dtos: MintCreditsDto[], actor?: string) {
    const startTime = performance.now();
    const executionLog = [];

    await this.prisma.$transaction(async (tx) => {
      for (const dto of dtos) {
        try {
          const existing = await tx.creditBatch.findUnique({ where: { batchId: dto.batchId } });
          if (existing) throw new BadRequestException(`Batch ${dto.batchId} already exists`);

          const serialStartUnits = BigInt(dto.serialStart);
          const serialEndUnits = BigInt(dto.serialEnd);
          if (serialStartUnits <= 0n || serialEndUnits <= 0n || serialEndUnits <= serialStartUnits) {
            throw new BadRequestException("serialEnd must be greater than serialStart and both must be positive");
          }

          const overlap = await tx.creditBatch.findFirst({
            where: {
              OR: [{ serialStart: { lte: dto.serialEnd }, serialEnd: { gte: dto.serialStart } }],
            },
          });
          if (overlap) throw new BadRequestException("Serial number range overlaps existing batch — double counting prevented");

          const batch = await tx.creditBatch.create({ data: dto });

          if (this.eventSourcing) {
            await this.eventSourcing.recordEvent({
              creditBatchId: batch.batchId,
              eventType: CreditEventType.MINT,
              actor: actor ?? dto.projectId ?? 'system',
              newState: {
                batchId: batch.batchId,
                projectId: batch.projectId,
                amountAvailable: Number(batch.amount),
                amountRetired: 0,
                status: 'Issued',
                vintageYear: batch.vintageYear,
                serialStart: batch.serialStart,
                serialEnd: batch.serialEnd,
              },
              txHash: (batch as any).txHash ?? 'STUB_MINT_HASH',
            }).catch(() => undefined);
          }

          executionLog.push({ batchId: dto.batchId, status: 'processed' });
        } catch (error: any) {
          executionLog.push({ batchId: dto.batchId, status: 'error', error: error.message });
          throw error; // Re-throw to rollback the entire transaction
        }
      }
    });

    if (this.queueService) {
      const chunkSize = 25; // chunk operations for BullMQ
      for (let i = 0; i < dtos.length; i += chunkSize) {
        const chunk = dtos.slice(i, i + chunkSize);
        await this.queueService.enqueue(JobType.BULK_MINT, { items: chunk });
      }
    }

    const duration = performance.now() - startTime;
    this.logger.log(`Processed bulk mint of ${dtos.length} items in ${duration.toFixed(2)}ms`);

    return {
      status: 'success',
      processed: dtos.length,
      executionLog,
      durationMs: duration
    };
  }

  async executeBulkMintJob(items: any[]) {
    this.logger.log(`Executing bulk mint on Stellar for ${items.length} items`);
    // Placeholder for actual Stellar SDK bulk operations
    return { status: 'submitted', itemsCount: items.length };
  }

  async getBatch(batchId: string) {
    const batch = await this.prisma.creditBatch.findFirst({ where: { batchId, deletedAt: null } });
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);
    return batch;
  }

  async getBatchesByProject(projectId: string) {
    return this.prisma.creditBatch.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { issuedAt: 'desc' },
    });
  }

  /**
   * Soft-delete a credit batch (#964). Retired/active batches stay queryable
   * by admins via the recovery endpoint until the retention job purges them;
   * every other read path (getBatch, getBatchesByProject, lookups, batch-retire
   * validation) excludes deletedAt rows by default.
   */
  async softDeleteBatch(batchId: string) {
    const batch = await this.prisma.creditBatch.findFirst({ where: { batchId, deletedAt: null } });
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);

    return this.prisma.creditBatch.update({
      where: { id: batch.id },
      data: { deletedAt: new Date() },
    });
  }

  /** Admin recovery (#964): un-hides a soft-deleted credit batch. */
  async restoreBatch(batchId: string) {
    const batch = await this.prisma.creditBatch.findFirst({ where: { batchId, deletedAt: { not: null } } });
    if (!batch) throw new NotFoundException(`Deleted batch ${batchId} not found`);

    return this.prisma.creditBatch.update({
      where: { id: batch.id },
      data: { deletedAt: null },
    });
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
    const r = await this.prisma.retirementRecord.findFirst({ where: { retirementId, deletedAt: null } });
    if (!r) throw new NotFoundException(`Retirement ${retirementId} not found`);
    return r;
  }

  async lookupSerial(serial: string) {
    const retirement = await this.prisma.retirementRecord.findFirst({
      where: { serialNumbers: { has: serial }, deletedAt: null },
    });
    if (retirement) return retirement;

    const batch = await this.prisma.creditBatch.findFirst({
      where: { serialStart: { lte: serial }, serialEnd: { gte: serial }, deletedAt: null },
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
   *
   * Performance: the batch lookup happens first (required to get batchId),
   * then retirement and event queries are issued in parallel to eliminate
   * sequential round-trips.  The composite index on (creditBatchId, timestamp)
   * covers the event query.
   */
  async getSerialProvenance(serial: string) {
    // 1. Locate the credit batch that owns this serial number.
    //    Must happen first — batchId is needed for all downstream queries.
    const batch = await this.prisma.creditBatch.findFirst({
      where: { serialStart: { lte: serial }, serialEnd: { gte: serial }, deletedAt: null },
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

    // 2. Issue retirement lookup and event log query in parallel —
    //    both depend only on data already available (serial, batchId).
    const [retirement, rawEvents] = await Promise.all([
      // Retirement is keyed by the serialNumbers GIN index
      this.prisma.retirementRecord.findFirst({
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
      }),
      // Events are covered by the (creditBatchId, timestamp) composite index
      (this.prisma as any).creditEvent.findMany({
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
      }) as Promise<Array<{
        id: string;
        creditBatchId: string;
        eventType: string;
        actor: string;
        oldState: unknown;
        newState: unknown;
        timestamp: Date;
        txHash: string;
      }>>,
    ]);

    // 3. Derive current owner from the latest transfer event, or fall back to
    //    the project's ownerAddress when no transfer events exist.
    const transferEvents = rawEvents.filter((e) => e.eventType === 'transfer');
    const lastTransfer   = transferEvents[transferEvents.length - 1] as
      | (typeof transferEvents[0] & { newState: { to?: string } | null })
      | undefined;

    const currentOwner = retirement
      ? null // retired — no current owner
      : (lastTransfer?.newState as { to?: string } | null)?.to
          ?? batch.project.ownerAddress;

    // 4. Compose the provenance response
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

  async batchMintCredits(dtos: MintCreditsDto[], actor?: string): Promise<BatchOperationResult<any>> {
    if (!dtos || !Array.isArray(dtos) || dtos.length === 0) {
      throw new BadRequestException("Batch input must be a non-empty array of items");
    }

    if (dtos.length > 1000) {
      throw new BadRequestException("Batch operations are limited to 1,000 items per request");
    }

    // Check payload internal duplicates
    const batchIdSet = new Set<string>();
    for (const dto of dtos) {
      if (batchIdSet.has(dto.batchId)) {
        throw new BadRequestException(`Duplicate batchId ${dto.batchId} found within the batch payload`);
      }
      batchIdSet.add(dto.batchId);
    }

    // Set-based pre-validations
    const batchIds = dtos.map((d) => d.batchId);
    const existingBatches = await this.prisma.creditBatch.findMany({
      where: { batchId: { in: batchIds } },
      select: { batchId: true },
    });
    if (existingBatches.length > 0) {
      const existingIds = existingBatches.map((b) => b.batchId).join(", ");
      throw new BadRequestException(`Batch ID(s) already exist: ${existingIds}`);
    }

    // Serial validation & format checks
    for (const dto of dtos) {
      if (!/^[0-9]+$/.test(dto.serialStart) || !/^[0-9]+$/.test(dto.serialEnd)) {
        throw new BadRequestException(`Invalid serial numbers for batch ${dto.batchId}: must be positive integer strings`);
      }
      const start = BigInt(dto.serialStart);
      const end = BigInt(dto.serialEnd);
      if (start <= 0n || end <= 0n || end <= start) {
        throw new BadRequestException(`Invalid serial range for batch ${dto.batchId}: serialEnd must be greater than serialStart`);
      }
    }

    // Bulk overlap check
    const overlaps = await this.prisma.creditBatch.findMany({
      where: {
        OR: dtos.map((dto) => ({
          serialStart: { lte: dto.serialEnd },
          serialEnd: { gte: dto.serialStart },
        })),
      },
      select: { batchId: true, serialStart: true, serialEnd: true },
    });
    if (overlaps.length > 0) {
      throw new BadRequestException("Serial number range overlaps existing batch(es) — double counting prevented");
    }

    // Atomic transaction: all or nothing
    const createdBatches = await this.prisma.$transaction(async (tx) => {
      await tx.creditBatch.createMany({
        data: dtos.map((dto) => ({
          batchId: dto.batchId,
          projectId: dto.projectId,
          vintageYear: dto.vintageYear,
          amount: dto.amount,
          serialStart: dto.serialStart,
          serialEnd: dto.serialEnd,
          metadataCid: dto.metadataCid,
          status: "Active",
        })),
      });

      return tx.creditBatch.findMany({
        where: { batchId: { in: batchIds } },
      });
    });

    const createdMap = new Map<string, any>((createdBatches as any[]).map((b: any) => [b.batchId, b]));

    // Asynchronous post-transaction side effects
    for (const dto of dtos) {
      const batch = createdMap.get(dto.batchId);
      if (!batch) continue;

      if (this.eventSourcing) {
        this.eventSourcing
          .recordEvent({
            creditBatchId: batch.batchId,
            eventType: CreditEventType.MINT,
            actor: actor ?? dto.projectId ?? "system",
            newState: {
              batchId: batch.batchId,
              projectId: batch.projectId,
              amountAvailable: Number(batch.amount),
              amountRetired: 0,
              status: "Issued",
              vintageYear: batch.vintageYear,
              serialStart: batch.serialStart,
              serialEnd: batch.serialEnd,
            },
            txHash: (batch as any).txHash ?? "STUB_MINT_HASH",
          })
          .catch(() => undefined);
      }

      if (this.webhookService) {
        this.webhookService
          .dispatch("credits.minted", {
            batchId: batch.batchId,
            projectId: batch.projectId,
            amount: Number(batch.amount),
            vintageYear: batch.vintageYear,
            serialStart: batch.serialStart,
            serialEnd: batch.serialEnd,
            timestamp: new Date().toISOString(),
          })
          .catch(() => undefined);
      }
    }

    const results: BatchItemStatus[] = dtos.map((dto, idx) => ({
      index: idx,
      status: "success",
      itemIdentifier: dto.batchId,
      data: createdMap.get(dto.batchId) ?? dto,
    }));

    return {
      success: true,
      totalProcessed: dtos.length,
      successCount: dtos.length,
      errorCount: 0,
      results,
    };
  }

  async batchRetireCredits(dtos: RetireCreditsDto[]): Promise<BatchOperationResult<any>> {
    if (!dtos || !Array.isArray(dtos) || dtos.length === 0) {
      throw new BadRequestException("Batch input must be a non-empty array of items");
    }

    if (dtos.length > 1000) {
      throw new BadRequestException("Batch operations are limited to 1,000 items per request");
    }

    const batchIds = dtos.map((d) => d.batchId);
    const batches = await this.prisma.creditBatch.findMany({
      where: { batchId: { in: batchIds }, deletedAt: null },
    });
    const batchMap = new Map<string, any>((batches as any[]).map((b: any) => [b.batchId, b]));

    // Validate every item and collect ALL failures instead of throwing on the
    // first one (#965) — a 1,000-item request should tell the caller exactly
    // which entries are bad in one round trip, not force a bisect-by-hand retry.
    // The transaction below stays fully atomic: if anything failed validation,
    // nothing is written and the response reports a reason per item.
    const seenBatchIds = new Set<string>();
    const itemErrors = new Map<number, string>();
    dtos.forEach((dto, idx) => {
      if (seenBatchIds.has(dto.batchId)) {
        itemErrors.set(idx, `Duplicate batchId ${dto.batchId} found within the batch payload`);
        return;
      }
      seenBatchIds.add(dto.batchId);

      const batch = batchMap.get(dto.batchId);
      if (!batch) {
        itemErrors.set(idx, `Batch ${dto.batchId} not found`);
      } else if (batch.status === "FullyRetired") {
        itemErrors.set(idx, `Batch ${dto.batchId} credits are already fully retired`);
      } else if (dto.amount > Number(batch.amount)) {
        itemErrors.set(idx, `Cannot retire ${dto.amount} tCO₂e from batch ${dto.batchId} — only ${batch.amount} tCO₂e available`);
      }
    });

    if (itemErrors.size > 0) {
      const results: BatchItemStatus[] = dtos.map((dto, idx) => {
        const error = itemErrors.get(idx);
        return error
          ? { index: idx, status: "error", itemIdentifier: dto.batchId, error }
          : {
              index: idx,
              status: "error",
              itemIdentifier: dto.batchId,
              error: "Skipped: the whole batch was rolled back because other item(s) in the request failed validation",
            };
      });

      throw new UnprocessableEntityException({
        success: false,
        totalProcessed: dtos.length,
        successCount: 0,
        errorCount: itemErrors.size,
        results,
      });
    }

    const retirementRecords = await this.prisma.$transaction(async (tx) => {
      const records = [];
      for (const dto of dtos) {
        const batch = batchMap.get(dto.batchId)!;
        const retirementId = `ret-${dto.batchId}-${Date.now()}-${randomBytes(4).toString("hex")}`;
        const serialStartUnits = BigInt(batch.serialStart);
        const retireUnits = toSerialUnits(dto.amount);
        const serialNumbers = Array.from({ length: Number(retireUnits) }, (_, i) =>
          String(serialStartUnits + BigInt(i))
        );

        const retirement = await tx.retirementRecord.create({
          data: {
            retirementId,
            batchId: dto.batchId,
            projectId: batch.projectId,
            amount: dto.amount,
            retiredBy: dto.holderPublicKey,
            beneficiary: dto.beneficiary,
            retirementReason: dto.retirementReason,
            vintageYear: batch.vintageYear,
            serialNumbers,
            txHash: randomBytes(32).toString("hex"),
            isValid: true,
          },
        });

        const batchAmount = Number(batch.amount);
        const newStatus = dto.amount >= batchAmount ? "FullyRetired" : "PartiallyRetired";
        await tx.creditBatch.update({
          where: { batchId: dto.batchId },
          data: { status: newStatus },
        });

        await tx.carbonProject.update({
          where: { projectId: batch.projectId },
          data: { totalCreditsRetired: { increment: dto.amount } },
        });

        records.push(retirement);
      }
      return records;
    });

    const results: BatchItemStatus[] = retirementRecords.map((r, idx) => ({
      index: idx,
      status: "success",
      itemIdentifier: r.retirementId,
      data: r,
    }));

    return {
      success: true,
      totalProcessed: dtos.length,
      successCount: dtos.length,
      errorCount: 0,
      results,
    };
  }
}

