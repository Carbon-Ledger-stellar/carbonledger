import { Module } from "@nestjs/common";
import { ProjectsController } from "./projects.controller";
import { PublicProjectsController } from "./public-projects.controller";
import { ProjectsService } from "./projects.service";
import { ProjectStateMachineService } from "./project-state-machine.service";
import { RegistryContractClient } from "./registry-contract.client";
import { PrismaService } from "../prisma.service";
import { AuthModule } from "../auth/auth.module";
import { MailModule } from "../mail/mail.module";
import { RedisService } from "../redis.service";
import { OracleContractClient } from "../oracle/oracle-contract.client";
import { PoliciesModule } from "../policies/policies.module";
import { WebhookModule } from "../webhook/webhook.module";
import { MarketplaceModule } from "../marketplace/marketplace.module";
import { CacheInvalidationService } from "../cache/cache.service";

@Module({
  imports: [AuthModule, MailModule, PoliciesModule, WebhookModule, MarketplaceModule],
  controllers: [ProjectsController, PublicProjectsController],
  providers: [ProjectsService, ProjectStateMachineService, PrismaService, RedisService, RegistryContractClient, OracleContractClient, CacheInvalidationService],
  exports: [ProjectsService],
})
export class ProjectsModule {}