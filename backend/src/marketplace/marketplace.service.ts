import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { CreateListingDto, PurchaseDto, BulkPurchaseDto, ListingsQueryDto, PaginatedListingsResponse } from "./marketplace.dto";
import { randomBytes } from "crypto";
import { ListingsCacheService } from "./listings-cache.service";
import { MarketplaceContractService } from "./marketplace-contract.service";

@Injectable()
export class MarketplaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ListingsCacheService,
    private readonly contractService: MarketplaceContractService,
  ) {}

  async findAll(query: ListingsQueryDto): Promise<PaginatedListingsResponse> {
    const cacheKey = JSON.stringify(query);
    const cached = await this.cache.get<PaginatedListingsResponse>(cacheKey);
    if (cached) return cached;

    const { methodology, vintage, country, minPrice, maxPrice, search, cursor, page, limit = 20 } = query;

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

    const orderBy = [{ vintageYear: "desc" as const }, { createdAt: "desc" as const }];

    // Page-based pagination (legacy)
    if (page !== undefined) {
      const skip = (page - 1) * limit;
      const [listings, total_count] = await Promise.all([
        this.prisma.marketListing.findMany({ where, orderBy, take: limit, skip }),
        this.prisma.marketListing.count({ where }),
      ]);
      const result: PaginatedListingsResponse = {
        listings,
        total_count,
        page,
        total_pages: Math.ceil(total_count / limit),
      };
      await this.cache.set(cacheKey, result);
      return result;
    }

    // Cursor-based pagination (issue #598)
    const [listings, total_count] = await Promise.all([
      this.prisma.marketListing.findMany({
        where,
        orderBy,
        take: limit + 1,
        cursor: decodedCursorId ? { id: decodedCursorId } : undefined,
        skip:   decodedCursorId ? 1 : 0,
      }),
      this.prisma.marketListing.count({ where }),
    ]);

    const hasMore = listings.length > limit;
    if (hasMore) listings.pop();

    // Encode next_cursor as opaque base64 JSON — stable under concurrent inserts
    const next_cursor = hasMore
      ? Buffer.from(JSON.stringify({ id: listings[listings.length - 1].id })).toString('base64')
      : undefined;

    // Encode prev_cursor pointing to the first item on this page
    const prev_cursor =
      decodedCursorId && listings.length > 0
        ? Buffer.from(JSON.stringify({ id: listings[0].id })).toString('base64')
        : undefined;

    const result: PaginatedListingsResponse = { listings, next_cursor, prev_cursor, total_count };
    await this.cache.set(cacheKey, result);
    return result;
  }

  async findOne(listingId: string) {
    const l = await this.prisma.marketListing.findUnique({ where: { listingId } });
    if (!l) throw new NotFoundException(`Listing ${listingId} not found`);
    return l;
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
    return { ...result, txHash };
  }

  async delistListing(listingId: string) {
    await this.findOne(listingId);
    
    // Call delist_credits on the carbon_marketplace contract
    const txHash = await this.contractService.delistCredits(listingId);
    
    // Update the listing status to delisted in PostgreSQL
    const result = await this.prisma.marketListing.update({
      where: { listingId },
      data:  { status: "Delisted" },
    });
    await this.cache.invalidateAll();
    
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

    return {
      txHash:  randomBytes(32).toString("hex"),
      batchId: listing.batchId,
      amount:  dto.amount,
    };
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
}
