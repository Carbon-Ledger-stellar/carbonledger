import { Module } from "@nestjs/common";
import { UploadsController } from "./uploads.controller";
import { IpfsUploadService } from "./ipfs-upload.service";
import { PrismaService } from "../prisma.service";

@Module({
  controllers: [UploadsController],
  providers: [IpfsUploadService, PrismaService],
  exports: [IpfsUploadService],
})
export class UploadsModule {}