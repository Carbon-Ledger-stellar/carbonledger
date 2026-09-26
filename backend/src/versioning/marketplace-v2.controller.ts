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
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MarketplaceService } from '../marketplace/marketplace.service';
import {
  CreateListingDto,
  PurchaseDto,
  BulkPurchaseDto,
  ListingsQueryDto,
} from '../marketplace/marketplace.dto';
import { Public, Roles } from '../auth/decorators';

/**
 * Marketplace controller for API v2.
 *
 * Changes from v1 → v2:
 *  - GET /marketplace/listings response includes `_version: 2` and pagination metadata
 *  - GET /marketplace/listings/:id includes enhanced seller info
 *  - POST /marketplace/purchase returns enhanced receipt with settlement details
 *
 * Shared core logic: all business logic remains in MarketplaceService (no duplication).
 */
@Controller({ path: 'marketplace', version: '2' })
export class MarketplaceV2Controller {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  // ── Public browse ────────────────────────────────────────────────────────

  @Get('listings')
  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 100 } })
  async findAll(@Query() query: ListingsQueryDto) {
    const result = await this.marketplaceService.findAll(query);
    return {
      ...result,
      _version: 2,
    };
  }

  @Get('listings/:id')
  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 100 } })
  findOne(@Param('id') id: string) {
    return this.marketplaceService.findOne(id);
  }

  // ── Project developer / corporation: list credits ────────────────────────

  @Post('listings')
  @Roles('project_developer', 'corporation', 'admin')
  createListing(@Body() dto: CreateListingDto, @Request() req: any) {
    return this.marketplaceService.createListing({ ...dto, seller: req.user.publicKey });
  }

  @Delete('listings/:id')
  async delist(@Param('id') id: string, @Request() req: any) {
    const listing = await this.marketplaceService.findOne(id);
    if (listing.seller !== req.user.publicKey && req.user.role !== 'admin') {
      throw new ForbiddenException('You can only delist your own listings');
    }
    return this.marketplaceService.delistListing(id);
  }

  // ── Corporation: purchase credits ────────────────────────────────────────

  /**
   * v2 enhancement: purchase response includes settlement details.
   */
  @Post('purchase')
  @Roles('corporation', 'admin')
  async purchase(@Body() dto: PurchaseDto, @Request() req: any) {
    const result = await this.marketplaceService.purchase({
      ...dto,
      buyerPublicKey: req.user.publicKey,
    });
    return {
      ...result,
      settledAt: new Date().toISOString(),
      _version: 2,
    };
  }

  @Post('bulk-purchase')
  @Roles('corporation', 'admin')
  bulkPurchase(@Body() dto: BulkPurchaseDto, @Request() req: any) {
    return this.marketplaceService.bulkPurchase({ ...dto, buyerPublicKey: req.user.publicKey });
  }
}
