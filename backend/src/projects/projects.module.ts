import { Module } from "@nestjs/common";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { ProjectStateMachineService } from "./project-state-machine.service";
import { PrismaService } from "../prisma.service";
import { AuthModule } from "../auth/auth.module";
import { MailModule } from "../mail/mail.module";

@Module({
  imports: [AuthModule, MailModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectStateMachineService, PrismaService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
