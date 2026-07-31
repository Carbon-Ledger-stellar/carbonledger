import { Module } from "@nestjs/common";
import { CreditsController } from "./credits.controller";
import { CreditsService } from "./credits.service";
import { PrismaService } from "../prisma.service";
import { AuthModule } from "../auth/auth.module";
import { MailModule } from "../mail/mail.module";
import { IpfsService } from "../common/ipfs.service";
import { PoliciesModule } from "../policies/policies.module";

@Module({
  imports: [AuthModule, MailModule, PoliciesModule],
  controllers: [CreditsController],
  providers: [CreditsService, PrismaService, IpfsService],
  exports: [CreditsService],
})
export class CreditsModule {}
