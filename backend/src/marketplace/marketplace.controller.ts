import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  Request,
  ForbiddenException,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MarketplaceService } from './marketplace.service';
import { MarketplaceSearchService } from './marketplace-search.service';
import { CreateListingDto, PurchaseDto, BulkPurchaseDto, ListingsQueryDto, SearchListingsDto, BatchCreateListingsDto } from './marketplace.dto';
import { Public, Roles } from '../auth/decorators';
import {
  CheckPolicies,
  PoliciesGuard,
  MarketListingSubject,
} from '../policies';
import { subject } from '@casl/ability';
import { AbilityFactory } from '../policies/ability.factory';

@Controller('marketplace')
export class MarketplaceController {
  constructor(
    private readonly marketplaceService: MarketplaceService,
    private readonly searchService: MarketplaceSearchService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  // ── Public browse ────────────────────────────────────────────────────────

  @Get('listings')
  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 100 } })
  findAll(@Query() query: ListingsQueryDto) {
    return this.marketplaceService.findAll(query);
  }

  @Get('listings/:id')
  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 100 } })
  findOne(@Param('id') id: string) {
    return this.marketplaceService.findOne(id);
  }

  /**
   * GET /marketplace/search
   *
   * Full-text and faceted search over marketplace listings.
   *
   * Supports:
   *   - Free-text search via ?search= (PostgreSQL tsvector / ts_rank)
   *   - Faceted filters: methodology, vintage, country, price range, status, seller
   *   - Relevance, price, vintage, and createdAt sort orders
   *   - Cursor-based keyset pagination
   *
   * Public — no authentication required.
   * Rate-limited at 100 requests per 60 seconds per IP.
   *
   * At least one filter must be provided. An empty query returns HTTP 400.
   */
  @Get('search')
  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 100 } })
  search(@Query() dto: SearchListingsDto) {
    return this.searchService.searchListings(dto);
  }

  // ── Project developer / corporation: list credits ────────────────────────

  @Post('listings')
  @Roles('project_developer', 'corporation', 'admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('list', MarketListingSubject))
  createListing(@Body() dto: CreateListingDto, @Request() req: any) {
    // Seller is always the authenticated user — prevents mass assignment
    return this.marketplaceService.createListing({ ...dto, seller: req.user.publicKey });
  }

  @Post('listings/batch')
  @Roles('project_developer', 'corporation', 'admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('list', MarketListingSubject))
  batchCreateListings(@Body() body: BatchCreateListingsDto | CreateListingDto[], @Request() req: any) {
    const rawItems = Array.isArray(body) ? body : body?.items;
    if (!rawItems || !Array.isArray(rawItems)) {
      throw new BadRequestException('Request body must be an array of CreateListingDto or contain an items array');
    }
    const items = rawItems.map((dto) => ({ ...dto, seller: req.user.publicKey }));
    return this.marketplaceService.batchCreateListings(items);
  }


  /**
   * DELETE /marketplace/listings/:id
   *
   * Fix IDOR: verify the caller owns the listing before delisting.
   * ABAC condition: MarketListingSubject.seller must match req.user.publicKey.
   */
  @Delete('listings/:id')
  async delist(@Param('id') id: string, @Request() req: any) {
    const listing = await this.marketplaceService.findOne(id);
    const ability = this.abilityFactory.createForUser(req.user);
    if (ability.cannot('delist', subject(MarketListingSubject, { seller: listing.seller }))) {
      throw new ForbiddenException('You can only delist your own listings');
    }
    return this.marketplaceService.delistListing(id);
  }

  // ── Corporation: purchase credits ────────────────────────────────────────

  @Post('purchase')
  @Roles('corporation', 'admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('purchase', MarketListingSubject))
  purchase(@Body() dto: PurchaseDto, @Request() req: any) {
    return this.marketplaceService.purchase({ ...dto, buyerPublicKey: req.user.publicKey });
  }

  @Post('bulk-purchase')
  @Roles('corporation', 'admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('purchase', MarketListingSubject))
  bulkPurchase(@Body() dto: BulkPurchaseDto, @Request() req: any) {
    return this.marketplaceService.bulkPurchase({ ...dto, buyerPublicKey: req.user.publicKey });
  }
}
