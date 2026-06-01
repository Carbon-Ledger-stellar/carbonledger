import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Body,
  Get,
  Param,
  Query,
  HttpException,
  HttpStatus,
  Req,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { IpfsUploadService } from "./ipfs-upload.service";
import { UploadFileDto, UploadResponseDto } from "./uploads.dto";
import { Request } from "express";
import { Public, Roles } from "../auth/decorators";

@Controller("uploads")
export class UploadsController {
  constructor(private readonly ipfsUploadService: IpfsUploadService) {}

  @Post("project/:projectId/documents")
  @Roles("project_developer", "admin")
  @UseInterceptors(FileInterceptor("file"))
  async uploadProjectDocument(
    @Param("projectId") projectId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() request: Request
  ) {
    const userId = (request as any).user?.id;

    if (!file) {
      throw new HttpException("No file uploaded", HttpStatus.BAD_REQUEST);
    }

    const fileSize = file.size;
    const fileName = file.originalname;
    const fileType = file.mimetype;

    const allowedTypes = ["application/pdf", "application/json"];
    if (!allowedTypes.includes(fileType)) {
      throw new HttpException(
        "Invalid file type. Only PDF and JSON files are allowed.",
        HttpStatus.BAD_REQUEST
      );
    }

    const maxSize = 52428800;
    if (fileSize > maxSize) {
      throw new HttpException(
        `File size exceeds 50MB limit (${fileSize} bytes)`,
        HttpStatus.BAD_REQUEST
      );
    }

    try {
      const result = await this.ipfsUploadService.uploadToPinata(
        fileName,
        fileType,
        file.buffer,
        fileSize,
        "project",
        projectId
      );

      return {
        success: true,
        message: "File uploaded successfully. Pinning in progress.",
        data: {
          id: result.id,
          cid: result.cid,
          fileName,
          fileType,
          fileSize,
          pinStatus: result.pinStatus,
          linkedEntityType: "project",
          linkedEntityId: projectId,
          uploadedAt: new Date().toISOString(),
          ipfsGatewayUrl: `https://gateway.pinata.cloud/ipfs/${result.cid}`,
        },
      };
    } catch (error: any) {
      throw new HttpException(
        error.message || "File upload failed",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post("certificate/:retirementId/certificate")
  @Roles("corporation", "admin")
  @UseInterceptors(FileInterceptor("file"))
  async uploadCertificate(
    @Param("retirementId") retirementId: string,
    @UploadedFile() file: Express.Multer.File
  ) {
    if (!file) {
      throw new HttpException("No file uploaded", HttpStatus.BAD_REQUEST);
    }

    const fileSize = file.size;
    const fileName = file.originalname;
    const fileType = file.mimetype;

    if (fileType !== "application/pdf") {
      throw new HttpException(
        "Invalid file type. Only PDF files are allowed for certificates.",
        HttpStatus.BAD_REQUEST
      );
    }

    const maxSize = 52428800;
    if (fileSize > maxSize) {
      throw new HttpException(
        `File size exceeds 50MB limit`,
        HttpStatus.BAD_REQUEST
      );
    }

    try {
      const result = await this.ipfsUploadService.uploadToPinata(
        fileName,
        fileType,
        file.buffer,
        fileSize,
        "certificate",
        retirementId
      );

      return {
        success: true,
        message: "Certificate uploaded successfully. Pinning in progress.",
        data: {
          id: result.id,
          cid: result.cid,
          fileName,
          fileType,
          fileSize,
          pinStatus: result.pinStatus,
          linkedEntityType: "certificate",
          linkedEntityId: retirementId,
          uploadedAt: new Date().toISOString(),
          ipfsGatewayUrl: `https://gateway.pinata.cloud/ipfs/${result.cid}`,
        },
      };
    } catch (error: any) {
      throw new HttpException(
        error.message || "Certificate upload failed",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post("webhook/pinata")
  @Public()
  async handlePinataWebhook(@Body() data: any) {
    try {
      await this.ipfsUploadService.handlePinataWebhook(data);
      return { success: true, message: "Webhook processed" };
    } catch (error: any) {
      throw new HttpException(
        error.message || "Webhook processing failed",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get("files")
  @Roles("admin")
  async getFiles(
    @Query("pinStatus") pinStatus?: string,
    @Query("linkedEntityType") linkedEntityType?: string,
    @Query("linkedEntityId") linkedEntityId?: string
  ) {
    const files = await this.ipfsUploadService.getFiles({
      pinStatus,
      linkedEntityType,
      linkedEntityId,
    });
    return { success: true, data: files };
  }

  @Get("files/:cid")
  @Public()
  async getFileByCid(@Param("cid") cid: string) {
    const file = await this.ipfsUploadService.getFileByCid(cid);
    if (!file) {
      throw new HttpException("File not found", HttpStatus.NOT_FOUND);
    }
    return {
      success: true,
      data: file,
    };
  }
}
