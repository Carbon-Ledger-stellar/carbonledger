import { Module, forwardRef } from "@nestjs/common";
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
import { CertificateSigningService } from "../common/certificate-signing.service";
import { ZkProofService } from "./zk-proof.service";
import { PoliciesModule } from "../policies/policies.module";
import { AbilityFactory } from "../policies/ability.factory";

@Module({
  imports: [
    AuthModule,
    forwardRef(() => QueueModule),
    UploadsModule,
    CertificatesModule,
    PoliciesModule,
    WebhookModule,
  ],
  controllers: [RetirementsController],
  providers: [
    RetirementsService,
    PrismaService,
    IpfsService,
    RetirementIndexerService,
    CertificateService,
    CertificateSigningService,
    ZkProofService,
    AbilityFactory,
  ],
  // CertificateService is exported because QueueProcessor (in the
  // forwardRef'd QueueModule) injects it directly — without this export
  // the whole app fails to boot under Nest's DI container (and every e2e
  // test with it).
  exports: [RetirementsService, CertificateService],
})
export class RetirementsModule {}
