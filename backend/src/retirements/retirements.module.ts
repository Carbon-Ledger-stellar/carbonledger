import { Module } from "@nestjs/common";
import { RetirementsController } from "./retirements.controller";
import { CertificatesController } from "./certificates.controller";
import { RetirementsService } from "./retirements.service";
import { RetirementIndexerService } from "./retirement-indexer.service";
import { PrismaService } from "../prisma.service";
import { AuthModule } from "../auth/auth.module";
import { IpfsService } from "../common/ipfs.service";
import { CertificatesModule } from "./certificates.module";
import { UploadsModule } from "../uploads/uploads.module";
import { QueueModule } from "../queue/queue.module";
import { CertificateService } from "./certificate.service";
import { ZkProofService } from "./zk-proof.service";
import { PoliciesModule } from "../policies/policies.module";
import { AbilityFactory } from "../policies/ability.factory";

@Module({
  imports: [AuthModule, QueueModule, UploadsModule, CertificatesModule, PoliciesModule],
  controllers: [RetirementsController, CertificatesController],
  providers: [
    RetirementsService,
    PrismaService,
    IpfsService,
    RetirementIndexerService,
    CertificateService,
    ZkProofService,
    AbilityFactory,
  ],
  exports: [RetirementsService],
})
export class RetirementsModule {}
