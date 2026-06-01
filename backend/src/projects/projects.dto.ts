import { IsString, IsInt, IsOptional, Min, Max, IsBoolean, IsEnum, IsArray, Matches, Length, MaxLength } from "class-validator";
import { Type, Transform } from "class-transformer";

// Valid IPFS CID: CIDv0 (Qm...) or CIDv1 (bafy...) — rejects URLs and arbitrary strings
const CID_REGEX = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/;

export class RegisterProjectDto {
  @IsString() @Length(1, 64) projectId: string;
  @IsString() @Length(1, 128) name: string;
  @IsString() @IsOptional() @MaxLength(1024) description?: string;
  @IsString() @Length(1, 64) methodology: string;
  @IsString() @Length(1, 64) country: string;
  @IsString() @Length(1, 64) projectType: string;
  @IsString() @Matches(CID_REGEX, { message: "metadataCid must be a valid IPFS CID (CIDv0 or CIDv1)" }) metadataCid: string;
  @IsString() @MaxLength(64) verifierAddress: string;
  @IsString() @MaxLength(64) ownerAddress: string;
  @IsInt() @Min(1990) @Max(new Date().getFullYear() + 1) @Type(() => Number) vintageYear: number;
  @IsInt() @Min(0) @Max(100) @Type(() => Number) methodologyScore: number;
}

export class UpdateProjectStatusDto {
  @IsString() status: string;
  @IsString() @IsOptional() reason?: string;
}

export enum ProjectStatus {
  PENDING = 'Pending',
  VERIFIED = 'Verified',
  REJECTED = 'Rejected',
  SUSPENDED = 'Suspended',
  COMPLETED = 'Completed',
  CERTIFIED = 'Certified'
}

export enum OracleFreshness {
  FRESH = 'fresh',
  STALE = 'stale',
  UNKNOWN = 'unknown'
}

export class SearchProjectsDto {
  @IsString() @IsOptional() @MaxLength(128) search?: string;
  
  @IsArray() @IsString({ each: true }) @IsOptional()
  @Transform(({ value }) => Array.isArray(value) ? value : [value])
  methodology?: string[];
  
  @IsArray() @IsString({ each: true }) @IsOptional()
  @Transform(({ value }) => Array.isArray(value) ? value : [value])
  country?: string[];
  
  @IsArray() @IsEnum(ProjectStatus, { each: true }) @IsOptional()
  @Transform(({ value }) => Array.isArray(value) ? value : [value])
  status?: ProjectStatus[];
  
  @IsArray() @IsInt({ each: true }) @Min(1990) @Max(new Date().getFullYear() + 1) @IsOptional()
  @Type(() => Number)
  @Transform(({ value }) => Array.isArray(value) ? value : [value])
  vintageYear?: number[];
  
  @IsEnum(OracleFreshness) @IsOptional() oracleFreshness?: OracleFreshness;
  
  @IsString() @IsOptional() @MaxLength(128) cursor?: string;
  
  @IsInt() @Min(1) @Max(100) @Type(() => Number) @IsOptional()
  limit?: number = 20;
  
  @IsString() @IsOptional() @MaxLength(32) sortBy?: 'createdAt' | 'vintageYear' | 'totalCreditsIssued' | 'name';
  
  @IsEnum(['asc', 'desc']) @IsOptional() sortOrder?: 'asc' | 'desc' = 'desc';
}

export class PaginatedProjectsResponse {
  projects: any[];
  nextCursor?: string;
  hasMore: boolean;
  total: number;
}
