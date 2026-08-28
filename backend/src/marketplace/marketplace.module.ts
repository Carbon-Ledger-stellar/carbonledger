import { Module } from "@nestjs/common";
import { MarketplaceController } from "./marketplace.controller";
import { MarketplaceService } from "./marketplace.service";
import { MarketplaceSearchService } from "./marketplace-search.service";
import { MarketplaceContractService } from "./marketplace-contract.service";
import { ListingsCacheService } from "./listings-cache.service";
import { PrismaService } from "../prisma.service";
import { AuthModule } from "../auth/auth.module";
import { PoliciesModule } from "../policies/policies.module";
import { AbilityFactory } from "../policies/ability.factory";
import { WebhookModule } from "../webhook/webhook.module";

@Module({
  imports: [AuthModule, PoliciesModule, WebhookModule],
  controllers: [MarketplaceController],
  providers: [
    MarketplaceService,
    MarketplaceSearchService,
    MarketplaceContractService,
    ListingsCacheService,
    PrismaService,
    AbilityFactory,
  ],
  exports: [ListingsCacheService],
})
export class MarketplaceModule {}
