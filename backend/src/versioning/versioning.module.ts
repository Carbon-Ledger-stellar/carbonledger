import { Module } from '@nestjs/common';
import { CreditsV2Controller } from './credits-v2.controller';
import { MarketplaceV2Controller } from './marketplace-v2.controller';
import { ProjectsV2Controller } from './projects-v2.controller';
import { CreditsModule } from '../credits/credits.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { ProjectsModule } from '../projects/projects.module';

/**
 * VersioningModule
 *
 * Registers the v2 controllers for all major API resources.
 * The v2 controllers share the same service layer as v1 (no logic duplication).
 *
 * The DeprecationMiddleware is applied globally in AppModule.configure().
 */
@Module({
  imports: [CreditsModule, MarketplaceModule, ProjectsModule],
  controllers: [CreditsV2Controller, MarketplaceV2Controller, ProjectsV2Controller],
})
export class VersioningModule {}
