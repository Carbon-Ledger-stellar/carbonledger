import { Module } from "@nestjs/common";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { ProjectStateMachineService } from "./project-state-machine.service";
import { RegistryContractClient } from "./registry-contract.client";
import { PrismaService } from "../prisma.service";
import { AuthModule } from "../auth/auth.module";
import { MailModule } from "../mail/mail.module";
import { RedisService } from "../redis.service";
import { OracleContractClient } from "../oracle/oracle-contract.client";

@Module({
  imports: [AuthModule, MailModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectStateMachineService, PrismaService, RedisService, RegistryContractClient, OracleContractClient],
  exports: [ProjectsService],
})
export class ProjectsModule {}
