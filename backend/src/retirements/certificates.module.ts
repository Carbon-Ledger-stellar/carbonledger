import { Module } from "@nestjs/common";
import { CertificateService } from "./certificate.service";
import { PrismaService } from "../prisma.service";
import { UploadsModule } from "../uploads/uploads.module";

@Module({
  imports: [UploadsModule],
  providers: [CertificateService, PrismaService],
  exports: [CertificateService],
})
export class CertificatesModule {}
