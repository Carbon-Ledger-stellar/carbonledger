import { Injectable, NotFoundException, BadRequestException, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { RedisService } from "../redis/redis.service";
import { CreateListingDto, PurchaseDto, BulkPurchaseDto } from "./marketplace.dto";
import { randomBytes } from "crypto";

const CACHE_TTL = 300; // 5 minutes
const LIST_PATTERN = "marketplace:listings:*";

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async findAll(filters: {
    methodology?: string;
    vintage?: number;
    country?: string;
    minPrice?: string;
    maxPrice?: string;
  }) {
    const cacheKey = `marketplace:listings:${JSON.stringify(filters)}`;

    // ── Cache read ─────────────────────────────────────────────────────────
    const cached = await this.redis.get(cacheKey);
    if (cached !== null) {
      this.logger.debug(`Cache HIT — ${cacheKey}`);
      return cached;
    }

    // ── DB fallback ────────────────────────────────────────────────────────
    this.logger.debug(`Cache MISS — fetching from DB for key: ${cacheKey}`);
    const results = await this.prisma.marketListing.findMany({
      where: {
        status: { in: ["Active", "PartiallyFilled"] },
        ...(filters.methodology && { methodology: filters.methodology }),
        ...(filters.vintage     && { vintageYear: filters.vintage }),
        ...(filters.country     && { country: filters.country }),
      },
      orderBy: { createdAt: "desc" },
    });

    await this.redis.set(cacheKey, results, CACHE_TTL);
    return results;
  }

  async findOne(listingId: string) {
    const l = await this.prisma.marketListing.findUnique({ where: { listingId } });
    if (!l) throw new NotFoundException(`Listing ${listingId} not found`);
    return l;
  }

  async createListing(dto: CreateListingDto) {
    const result = await this.prisma.marketListing.create({ data: dto });
    // New listing changes the collection — invalidate all listing caches
    await this.redis.delPattern(LIST_PATTERN);
    return result;
  }

  async delistListing(listingId: string) {
    await this.findOne(listingId);
    const result = await this.prisma.marketListing.update({
      where: { listingId },
      data:  { status: "Delisted" },
    });
    // Listing removed from active set — invalidate
    await this.redis.delPattern(LIST_PATTERN);
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

    // Amount/status changed — invalidate listing caches
    await this.redis.delPattern(LIST_PATTERN);

    return {
      txHash:  randomBytes(32).toString("hex"),
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
    // delPattern is called inside each purchase() call — no extra invalidation needed
    return results;
  }
}
