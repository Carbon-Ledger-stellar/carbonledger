import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-type-json';
import { Public } from '../../auth/decorators';
import { MarketplaceSearchService } from '../../marketplace/marketplace-search.service';
import { MarketplaceService } from '../../marketplace/marketplace.service';
import {
  MarketplaceListingType,
  MarketplacePage,
  PurchaseCreditsInput,
  SearchMarketplaceInput,
} from '../types/marketplace.type';

@Resolver(() => MarketplaceListingType)
export class MarketplaceResolver {
  constructor(
    private readonly marketplaceService: MarketplaceService,
    private readonly searchService: MarketplaceSearchService,
  ) {}

  @Query(() => MarketplacePage, { name: 'searchMarketplace' })
  @Public()
  async searchMarketplace(@Args('input') input: SearchMarketplaceInput) {
    const result = await this.searchService.searchListings(input as any);
    return {
      listings: result.results,
      total: result.total_count,
      hasMore: result.has_more,
      nextCursor: result.next_cursor,
    };
  }

  @Mutation(() => GraphQLJSON, { name: 'purchaseCredits' })
  async purchaseCredits(@Args('input') input: PurchaseCreditsInput, @Context() ctx: any) {
    const user = ctx.req?.user;
    if (!user) throw new UnauthorizedException('Authentication required');
    if (!['corporation', 'admin'].includes(user.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return this.marketplaceService.purchase({ ...input, buyerPublicKey: user.publicKey });
  }
}