import { Module } from "@nestjs/common";
import { RetirementsController } from "./retirements.controller";
import { RetirementsService } from "./retirements.service";
import { RetirementIndexerService } from "./retirement-indexer.service";
import { PrismaService } from "../prisma.service";
import { AuthModule } from "../auth/auth.module";
import { IpfsService } from "../common/ipfs.service";
import { CertificatesModule } from "../certificates/certificates.module";
import { UploadsModule } from "../uploads/uploads.module";
import { QueueModule } from "../queue/queue.module";
import { WebhookModule } from "../webhook/webhook.module";
import { CertificateService } from "./certificate.service";
import { ZkProofService } from "./zk-proof.service";

@Module({
  imports: [AuthModule, QueueModule, UploadsModule, CertificatesModule, WebhookModule],
  controllers: [RetirementsController],
  providers: [
    RetirementsService,
    PrismaService,
    IpfsService,
    RetirementIndexerService,
    CertificateService,
    ZkProofService,
  ],
  exports: [RetirementsService],
})
export class RetirementsModule {}
