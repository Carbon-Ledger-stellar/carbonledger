import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { CreateListingDto, PurchaseDto, BulkPurchaseDto, ListingsQueryDto, PaginatedListingsResponse } from "./marketplace.dto";
import { randomBytes } from "crypto";
import { ListingsCacheService } from "./listings-cache.service";
import { MarketplaceContractService } from "./marketplace-contract.service";
import { WebhookService } from "../webhook/webhook.service";

import { EventSourcingService } from "../events/event-sourcing.service";
import { CreditEventType } from "../events/credit-event.types";
import { buildCursorWhere, createOpaqueCursor, decodeCursor, normalizePaginationLimit } from "../common/cursor-pagination";

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ListingsCacheService,
    private readonly contractService: MarketplaceContractService,
    @Optional() private readonly webhookService?: WebhookService,
    @Optional() private readonly eventSourcing?: EventSourcingService,
  ) {}

  /** projectName isn't a MarketListing column — it's joined in from the related project for display. */
  private static withProjectName(listing: any): any {
    if (!listing || !listing.project) return listing;
    const { project, ...rest } = listing;
    return { ...rest, projectName: project.name };
  }

  /**
   * pricePerCredit is stored as a String (to preserve exact decimal precision), so it
   * can't be ordered numerically at the DB level without a migration. Sorting by price
   * is therefore done in memory over a bounded window of matching rows.
   */
  private static readonly PRICE_SORT_ROW_CAP = 1000;

  private buildOrderBy(sortBy: ListingsQueryDto["sortBy"], sortOrder: "asc" | "desc") {
    switch (sortBy) {
      case "vintageYear":
        return [{ vintageYear: sortOrder }];
      case "methodology":
        return [{ methodology: sortOrder }];
      case "verificationDate":
        // No dedicated verifiedAt column exists yet — the project's updatedAt
        // timestamp is the closest available proxy (it changes when a verifier
        // approves/updates the project record).
        return [{ project: { updatedAt: sortOrder } }];
      default:
        return [{ vintageYear: "desc" as const }, { createdAt: "desc" as const }];
    }
  }

  async findAll(query: ListingsQueryDto): Promise<PaginatedListingsResponse> {
    const cacheKey = JSON.stringify(query);
    const cached = await this.cache.get<PaginatedListingsResponse>(cacheKey);
    if (cached) return cached;

    const { methodology, vintage, country, minPrice, maxPrice, search, cursor, page, limit = 20, offset = 0, sortBy, sortOrder = "asc" } = query;
    const normalizedLimit = normalizePaginationLimit(limit, 100);
    const safeOffset = typeof offset === 'number' && offset >= 0 ? offset : 0;
    const decodedCursor = decodeCursor(cursor);

    // Validate price range values
    if (minPrice !== undefined && isNaN(parseFloat(minPrice))) {
      throw new BadRequestException("minPrice must be a valid numeric string");
    }
    if (maxPrice !== undefined && isNaN(parseFloat(maxPrice))) {
      throw new BadRequestException("maxPrice must be a valid numeric string");
    }
    if (minPrice !== undefined && maxPrice !== undefined && parseFloat(minPrice) > parseFloat(maxPrice)) {
      throw new BadRequestException("minPrice must be less than or equal to maxPrice");
    }

    // Decode opaque cursor — base64-encoded JSON { id: string }
    let decodedCursorId: string | undefined;
    if (cursor) {
      try {
        const raw = Buffer.from(cursor, 'base64').toString('utf8');
        const parsed = JSON.parse(raw);
        if (typeof parsed.id !== 'string') throw new Error('missing id');
        decodedCursorId = parsed.id;
      } catch {
        throw new BadRequestException('Invalid cursor');
      }
    }

    const where: any = {
      status: { in: ["Active", "PartiallyFilled"] },
      ...(methodology && { methodology }),
      ...(vintage     && { vintageYear: vintage }),
      ...(country     && { country }),
      ...(minPrice    && { pricePerCredit: { gte: minPrice } }),
      ...(maxPrice    && { pricePerCredit: { lte: maxPrice } }),
    };

    if (search) {
      where.OR = [
        { project: { name: { contains: search, mode: "insensitive" } } },
        { methodology: { contains: search, mode: "insensitive" } },
        { country: { contains: search, mode: "insensitive" } },
        { projectId: { contains: search, mode: "insensitive" } },
      ];
    }

    const include = { project: { select: { name: true } } };

    if (sortBy === "price") {
      const [rows, total_count] = await Promise.all([
        this.prisma.marketListing.findMany({ where, include, take: MarketplaceService.PRICE_SORT_ROW_CAP }),
        this.prisma.marketListing.count({ where }),
      ]);
      const sorted = rows
        .map(MarketplaceService.withProjectName)
        .sort((a, b) => {
          const diff = parseFloat(a.pricePerCredit) - parseFloat(b.pricePerCredit);
          return sortOrder === "desc" ? -diff : diff;
        });

      const effectivePage = page ?? 1;
      const start = page !== undefined ? (effectivePage - 1) * normalizedLimit : safeOffset;
      const listings = sorted.slice(start, start + normalizedLimit);
      const hasMore = start + listings.length < total_count;

      const result: PaginatedListingsResponse = {
        data: listings,
        listings,
        total: total_count,
        total_count,
        limit: normalizedLimit,
        offset: start,
        hasMore,
        has_more: hasMore,
        nextOffset: hasMore ? start + normalizedLimit : null,
        page: effectivePage,
        total_pages: Math.ceil(total_count / normalizedLimit),
      };
      await this.cache.set(cacheKey, result);
      return result;
    }

    const orderBy = this.buildOrderBy(sortBy, sortOrder);

    // Page-based pagination (legacy)
    if (page !== undefined) {
      const skip = (page - 1) * normalizedLimit;
      const [listings, total_count] = await Promise.all([
        this.prisma.marketListing.findMany({ where, include, orderBy, take: normalizedLimit + 1, skip }),
        this.prisma.marketListing.count({ where }),
      ]);
      const hasMore = listings.length > normalizedLimit;
      if (hasMore) listings.pop();
      const mapped = listings.map(MarketplaceService.withProjectName);

      const result: PaginatedListingsResponse = {
        data: mapped,
        listings: mapped,
        total: total_count,
        total_count,
        limit: normalizedLimit,
        offset: skip,
        hasMore,
        has_more: hasMore,
        nextOffset: hasMore ? skip + normalizedLimit : null,
        page,
        total_pages: Math.ceil(total_count / normalizedLimit),
      };
      await this.cache.set(cacheKey, result);
      return result;
    }

    // Offset / Cursor-based pagination
    const [listings, total_count] = await Promise.all([
      this.prisma.marketListing.findMany({
        where,
        include,
        orderBy,
        take: normalizedLimit + 1,
        cursor: decodedCursorId ? { id: decodedCursorId } : undefined,
        skip: decodedCursorId ? 1 : safeOffset,
      }),
      this.prisma.marketListing.count({ where }),
    ]);

    const hasMore = listings.length > normalizedLimit;
    if (hasMore) listings.pop();
    const mapped = listings.map(MarketplaceService.withProjectName);

    // Encode next_cursor as opaque base64 JSON — matches the { id } shape
    // this method already decodes above.
    const next_cursor = hasMore
      ? Buffer.from(JSON.stringify({ id: listings[listings.length - 1].id })).toString('base64')
      : undefined;

    // Encode prev_cursor pointing back to the first item of this page.
    const prev_cursor = decodedCursorId && listings.length > 0
      ? Buffer.from(JSON.stringify({ id: listings[0].id })).toString('base64')
      : undefined;

    const result: PaginatedListingsResponse = {
      data: mapped,
      listings: mapped,
      total: total_count,
      total_count,
      limit: normalizedLimit,
      offset: safeOffset,
      hasMore,
      has_more: hasMore,
      nextOffset: hasMore ? safeOffset + normalizedLimit : null,
      next_cursor,
      prev_cursor,
    };
    await this.cache.set(cacheKey, result);
    return result;
  }

  async findOne(listingId: string) {
    const l = await this.prisma.marketListing.findUnique({
      where: { listingId },
      include: { project: { select: { name: true } } },
    });
    if (!l) throw new NotFoundException(`Listing ${listingId} not found`);
    return MarketplaceService.withProjectName(l);
  }

  async createListing(dto: CreateListingDto & { seller: string }) {
    // Verify the caller owns the credit batch via contract read
    const ownsBatch = await this.contractService.verifyCreditBatchOwnership(dto.credit_batch_id, dto.seller);
    if (!ownsBatch) {
      throw new ForbiddenException('You do not own the specified credit batch');
    }

    // Call list_credits on the carbon_marketplace contract
    const txHash = await this.contractService.listCredits(
      dto.listingId,
      dto.credit_batch_id,
      dto.amount,
      dto.price_per_tonne,
    );

    // Fix mass assignment (API3): explicitly pick only allowed fields — never trust the full DTO object
    const result = await this.prisma.marketListing.create({
      data: {
        listingId:       dto.listingId,
        projectId:       dto.projectId,
        batchId:         dto.credit_batch_id,  // Map credit_batch_id to batchId
        seller:          dto.seller,          // always from req.user.publicKey via controller
        amountAvailable: dto.amount,          // Map amount to amountAvailable
        pricePerCredit:  dto.price_per_tonne, // Map price_per_tonne to pricePerCredit
        vintageYear:     dto.vintageYear,
        methodology:     dto.methodology,
        country:         dto.country,
        status:          "Active",            // status is never accepted from the client
      },
    });
    await this.cache.invalidateAll();

    if (this.eventSourcing) {
      await this.eventSourcing.recordEvent({
        creditBatchId: dto.credit_batch_id,
        eventType: CreditEventType.LIST,
        actor: dto.seller,
        newState: {
          listingId: dto.listingId,
          batchId: dto.credit_batch_id,
          projectId: dto.projectId,
          seller: dto.seller,
          pricePerCredit: dto.price_per_tonne,
          amountAvailable: dto.amount,
          status: 'Listed',
        },
        txHash,
      }).catch(() => undefined);
    }

    return { ...result, txHash };
  }

  async delistListing(listingId: string) {
    const listing = await this.findOne(listingId);
    
    // Call delist_credits on the carbon_marketplace contract
    const txHash = await this.contractService.delistCredits(listingId);
    
    // Update the listing status to delisted in PostgreSQL
    const result = await this.prisma.marketListing.update({
      where: { listingId },
      data:  { status: "Delisted" },
    });
    await this.cache.invalidateAll();
    
    if (this.eventSourcing && listing.batchId) {
      await this.eventSourcing.recordEvent({
        creditBatchId: listing.batchId,
        eventType: CreditEventType.DELIST,
        actor: listing.seller,
        oldState: { status: 'Listed' },
        newState: { listingId, status: 'Delisted' },
        txHash,
      }).catch(() => undefined);
    }

    return { ...result, txHash };
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

    await this.prisma.marketListing.update({
      where: { listingId: dto.listingId },
      data:  { amountAvailable: newAmount, status: newStatus },
    });

    const txHash = randomBytes(32).toString("hex");
    const result = {
      txHash,
      batchId: listing.batchId,
      amount: dto.amount,
    };

    if (this.eventSourcing && listing.batchId) {
      await this.eventSourcing.recordEvent({
        creditBatchId: listing.batchId,
        eventType: CreditEventType.PURCHASE,
        actor: dto.buyerPublicKey,
        oldState: { amountAvailable: listing.amountAvailable, ownerPublicKey: listing.seller },
        newState: {
          batchId: listing.batchId,
          amountAvailable: newAmount,
          ownerPublicKey: dto.buyerPublicKey,
          status: newStatus === 'Sold' ? 'Sold' : 'Listed',
        },
        txHash,
      }).catch(() => undefined);
    }

    // Dispatch webhook: credit.purchased
    try {
      if (this.webhookService) {
        await this.webhookService.dispatch('credit.purchased', {
          listingId: dto.listingId,
          batchId: listing.batchId,
          projectId: listing.projectId,
          buyer: dto.buyerPublicKey,
          seller: listing.seller,
          amount: dto.amount,
          pricePerCredit: listing.pricePerCredit,
          txHash,
          vintageYear: listing.vintageYear,
          methodology: listing.methodology,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (webhookError) {
      this.logger.warn(`Failed to dispatch webhook: ${webhookError instanceof Error ? webhookError.message : String(webhookError)}`);
    }

    return result;
  }

  async bulkPurchase(dto: BulkPurchaseDto) {
    // Fix API4: enforce cap at service layer in case DTO validation is bypassed
    if (dto.listingIds.length > 50) {
      throw new BadRequestException("Bulk purchase is limited to 50 listings per request");
    }
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

  async batchCreateListings(dtos: Array<CreateListingDto & { seller: string }>) {
    if (!dtos || !Array.isArray(dtos) || dtos.length === 0) {
      throw new BadRequestException("Batch input must be a non-empty array of items");
    }
    if (dtos.length > 1000) {
      throw new BadRequestException("Batch operations are limited to 1,000 items per request");
    }

    for (const dto of dtos) {
      const ownsBatch = await this.contractService.verifyCreditBatchOwnership(dto.credit_batch_id, dto.seller);
      if (!ownsBatch) {
        throw new ForbiddenException(`You do not own the credit batch ${dto.credit_batch_id}`);
      }
    }

    const createdListings = await this.prisma.$transaction(async (tx) => {
      const records = [];
      for (const dto of dtos) {
        const txHash = await this.contractService.listCredits(
          dto.listingId,
          dto.credit_batch_id,
          dto.amount,
          dto.price_per_tonne,
        );

        const listing = await tx.marketListing.create({
          data: {
            listingId:       dto.listingId,
            projectId:       dto.projectId,
            batchId:         dto.credit_batch_id,
            seller:          dto.seller,
            amountAvailable: dto.amount,
            pricePerCredit:  dto.price_per_tonne,
            vintageYear:     dto.vintageYear,
            methodology:     dto.methodology,
            country:         dto.country,
            status:          "Active",
          },
        });
        records.push({ listing, txHash });
      }
      return records;
    });

    await this.cache.invalidateAll();

    for (let i = 0; i < dtos.length; i++) {
      const dto = dtos[i];
      const { txHash } = createdListings[i];
      if (this.eventSourcing) {
        this.eventSourcing.recordEvent({
          creditBatchId: dto.credit_batch_id,
          eventType: CreditEventType.LIST,
          actor: dto.seller,
          newState: {
            listingId: dto.listingId,
            batchId: dto.credit_batch_id,
            projectId: dto.projectId,
            seller: dto.seller,
            pricePerCredit: dto.price_per_tonne,
            amountAvailable: dto.amount,
            status: 'Listed',
          },
          txHash,
        }).catch(() => undefined);
      }
    }

    const results = createdListings.map(({ listing, txHash }, idx) => ({
      index: idx,
      status: "success" as const,
      itemIdentifier: listing.listingId,
      data: { ...listing, txHash },
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

