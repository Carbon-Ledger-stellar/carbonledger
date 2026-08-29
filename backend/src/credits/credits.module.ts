import { Module, forwardRef } from "@nestjs/common";
import { CreditsController } from "./credits.controller";
import { CreditsService } from "./credits.service";
import { PrismaService } from "../prisma.service";
import { AuthModule } from "../auth/auth.module";
import { MailModule } from "../mail/mail.module";
import { IpfsService } from "../common/ipfs.service";
import { PoliciesModule } from "../policies/policies.module";
import { WebhookModule } from "../webhook/webhook.module";
import { QueueModule } from "../queue/queue.module";

@Module({
  imports: [AuthModule, MailModule, PoliciesModule, WebhookModule, forwardRef(() => QueueModule)],
  controllers: [CreditsController],
  providers: [CreditsService, PrismaService, IpfsService],
  exports: [CreditsService],
})
export class CreditsModule {}
