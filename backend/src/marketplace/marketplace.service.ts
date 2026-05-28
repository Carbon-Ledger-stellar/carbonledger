import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { CreateListingDto, PurchaseDto, BulkPurchaseDto, ListingsQueryDto, PaginatedListingsResponse } from "./marketplace.dto";
import { randomBytes } from "crypto";
import { ListingsCacheService } from "./listings-cache.service";

@Injectable()
export class MarketplaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ListingsCacheService,
  ) {}

  async findAll(query: ListingsQueryDto): Promise<PaginatedListingsResponse> {
    const cacheKey = JSON.stringify(query);
    const cached = await this.cache.get<PaginatedListingsResponse>(cacheKey);
    if (cached) return cached;

    const { methodology, vintage, country, minPrice, maxPrice, search, cursor, limit = 20 } = query;

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

    const [listings, total_count] = await Promise.all([
      this.prisma.marketListing.findMany({
        where,
        orderBy: [
          { vintageYear: "desc" },
          { createdAt: "desc" },
        ],
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        skip: cursor ? 1 : 0,
      }),
      this.prisma.marketListing.count({ where }),
    ]);

    const hasMore = listings.length > limit;
    const next_cursor = hasMore ? listings[listings.length - 2].id : undefined;
    if (hasMore) listings.pop();

    const result = { listings, next_cursor, total_count };
    await this.cache.set(cacheKey, result);
    return result;
  }

  async findOne(listingId: string) {
    const l = await this.prisma.marketListing.findUnique({ where: { listingId } });
    if (!l) throw new NotFoundException(`Listing ${listingId} not found`);
    return l;
  }

  async createListing(dto: CreateListingDto & { seller: string }) {
    // Fix mass assignment (API3): explicitly pick only allowed fields — never trust the full DTO object
    const result = await this.prisma.marketListing.create({
      data: {
        listingId:       dto.listingId,
        projectId:       dto.projectId,
        batchId:         dto.batchId,
        seller:          dto.seller,          // always from req.user.publicKey via controller
        amountAvailable: dto.amountAvailable,
        pricePerCredit:  dto.pricePerCredit,
        vintageYear:     dto.vintageYear,
        methodology:     dto.methodology,
        country:         dto.country,
        status:          "Active",            // status is never accepted from the client
      },
    });
    await this.cache.invalidateAll();
    return result;
  }

  async delistListing(listingId: string) {
    await this.findOne(listingId);
    const result = await this.prisma.marketListing.update({
      where: { listingId },
      data:  { status: "Delisted" },
    });
    await this.cache.invalidateAll();
    return result;
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
