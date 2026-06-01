import { IsString, IsOptional, IsNotEmpty, IsInt, Min, Max } from "class-validator";

export class UploadFileDto {
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  fileType!: string;

  @IsInt()
  @Min(1)
  @Max(52428800) // 50MB in bytes
  fileSize!: number;

  @IsString()
  @IsOptional()
  linkedEntityType?: string;

  @IsString()
  @IsOptional()
  linkedEntityId?: string;
}

export class UploadResponseDto {
  id: string;
  cid: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  pinStatus: string;
  linkedEntityType?: string;
  linkedEntityId?: string;
  uploadedAt: string;
}

export class PinataWebhookDto {
  id: string;
  status: string;
  pinataApiError?: string;
}