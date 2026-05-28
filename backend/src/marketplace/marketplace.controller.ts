import { Controller, Get, Post, Delete, Param, Body, Query, Request, ForbiddenException } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { CreateListingDto, PurchaseDto, BulkPurchaseDto, ListingsQueryDto } from './marketplace.dto';
import { Public, Roles } from '../auth/decorators';

@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  // ── Public browse ────────────────────────────────────────────────────────

  @Get('listings')
  @Public()
  findAll(@Query() query: ListingsQueryDto) {
    return this.marketplaceService.findAll(query);
  }

  @Get('listings/:id')
  @Public()
  findOne(@Param('id') id: string) {
    return this.marketplaceService.findOne(id);
  }

  // ── Project developer / corporation: list credits ────────────────────────

  @Post('list')
  @Roles('project_developer', 'corporation', 'admin')
  createListing(@Body() dto: CreateListingDto, @Request() req: any) {
    // Fix mass assignment: seller is always the authenticated user
    return this.marketplaceService.createListing({ ...dto, seller: req.user.publicKey });
  }

  @Delete(':id')
  async delist(@Param('id') id: string, @Request() req: any) {
    // Fix IDOR: verify the caller owns the listing before delisting
    const listing = await this.marketplaceService.findOne(id);
    if (listing.seller !== req.user.publicKey && req.user.role !== 'admin') {
      throw new ForbiddenException('You can only delist your own listings');
    }
    return this.marketplaceService.delistListing(id);
  }

  // ── Corporation: purchase credits ────────────────────────────────────────

  @Post('purchase')
  @Roles('corporation', 'admin')
  purchase(@Body() dto: PurchaseDto, @Request() req: any) {
    return this.marketplaceService.purchase({ ...dto, buyerPublicKey: req.user.publicKey });
  }

  @Post('bulk-purchase')
  @Roles('corporation', 'admin')
  bulkPurchase(@Body() dto: BulkPurchaseDto, @Request() req: any) {
    return this.marketplaceService.bulkPurchase({ ...dto, buyerPublicKey: req.user.publicKey });
  }
}
