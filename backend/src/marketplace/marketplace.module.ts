import { Module } from "@nestjs/common";
import { MarketplaceController } from "./marketplace.controller";
import { MarketplaceService } from "./marketplace.service";
import { MarketplaceContractService } from "./marketplace-contract.service";
import { ListingsCacheService } from "./listings-cache.service";
import { PrismaService } from "../prisma.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [MarketplaceController],
  providers: [MarketplaceService, MarketplaceContractService, ListingsCacheService, PrismaService],
})
export class MarketplaceModule {}
