import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { CreateListingDto, PurchaseDto, BulkPurchaseDto } from "./marketplace.dto";
import { randomBytes } from "crypto";
import { EventSourcingService } from "../events/event-sourcing.service";
import { CreditEventType } from "../events/credit-event.types";

@Injectable()
export class MarketplaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventSourcing: EventSourcingService,
  ) {}

  async findAll(filters: { methodology?: string; vintage?: number; country?: string; minPrice?: string; maxPrice?: string }) {
    return this.prisma.marketListing.findMany({
      where: {
        status: { in: ["Active", "PartiallyFilled"] },
        ...(filters.methodology && { methodology: filters.methodology }),
        ...(filters.vintage     && { vintageYear: filters.vintage }),
        ...(filters.country     && { country: filters.country }),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(listingId: string) {
    const l = await this.prisma.marketListing.findUnique({ where: { listingId } });
    if (!l) throw new NotFoundException(`Listing ${listingId} not found`);
    return l;
  }

  async createListing(dto: CreateListingDto, actor?: string) {
    const listing = await this.prisma.marketListing.create({ data: dto });

    // Record list event
    await this.eventSourcing.recordEvent({
      creditBatchId: listing.batchId,
      eventType:     CreditEventType.LIST,
      actor:         actor ?? listing.seller,
      oldState:      null,
      newState: {
        listingId:      listing.listingId,
        batchId:        listing.batchId,
        projectId:      listing.projectId,
        seller:         listing.seller,
        amountAvailable: listing.amountAvailable,
        pricePerCredit: listing.pricePerCredit,
        vintageYear:    listing.vintageYear,
        methodology:    listing.methodology,
        country:        listing.country,
        status:         listing.status,
      },
      txHash: randomBytes(32).toString("hex"),
    });

    return listing;
  }

  async delistListing(listingId: string, actor?: string) {
    const listing = await this.findOne(listingId);
    const updated = await this.prisma.marketListing.update({
      where: { listingId },
      data:  { status: "Delisted" },
    });

    // Record delist event
    await this.eventSourcing.recordEvent({
      creditBatchId: listing.batchId,
      eventType:     CreditEventType.DELIST,
      actor:         actor ?? listing.seller,
      oldState: {
        listingId: listing.listingId,
        status:    listing.status,
        amountAvailable: listing.amountAvailable,
      },
      newState: {
        listingId: listing.listingId,
        status:    "Delisted",
        amountAvailable: listing.amountAvailable,
      },
      txHash: randomBytes(32).toString("hex"),
    });

    return updated;
  }

  async purchase(dto: PurchaseDto) {
    const listing = await this.findOne(dto.listingId);
    if (!["Active", "PartiallyFilled"].includes(listing.status)) {
      throw new BadRequestException("Listing is not available");
    }
    if (dto.amount > listing.amountAvailable) {
      throw new BadRequestException("Insufficient credits in listing");
    }

    const newAmount = listing.amountAvailable - dto.amount;
    const newStatus = newAmount === 0 ? "Sold" : "PartiallyFilled";
    const txHash    = randomBytes(32).toString("hex");

    await this.prisma.marketListing.update({
      where: { listingId: dto.listingId },
      data:  { amountAvailable: newAmount, status: newStatus },
    });

    // Record transfer (purchase) event on the underlying batch
    await this.eventSourcing.recordEvent({
      creditBatchId: listing.batchId,
      eventType:     CreditEventType.TRANSFER,
      actor:         dto.buyerPublicKey,
      oldState: {
        listingId:       listing.listingId,
        amountAvailable: listing.amountAvailable,
        status:          listing.status,
        owner:           listing.seller,
      },
      newState: {
        listingId:       listing.listingId,
        amountAvailable: newAmount,
        status:          newStatus,
        transferredAmount: dto.amount,
        buyer:           dto.buyerPublicKey,
        seller:          listing.seller,
        txHash,
      },
      txHash,
    });

    return {
      txHash,
      batchId: listing.batchId,
      amount:  dto.amount,
    };
  }

  async bulkPurchase(dto: BulkPurchaseDto) {
    const results = [];
    for (let i = 0; i < dto.listingIds.length; i++) {
      const result = await this.purchase({
        listingId:      dto.listingIds[i],
        amount:         dto.amounts[i],
        buyerPublicKey: dto.buyerPublicKey,
      });
      results.push(result);
    }
    return results;
  }
}
