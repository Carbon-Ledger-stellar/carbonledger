import {
  IsString,
  IsInt,
  IsOptional,
  Min,
  Max,
  IsBoolean,
  IsEnum,
  IsArray,
  Length,
  MaxLength,
  IsNotEmpty,
  ValidateNested,
  IsObject,
  IsNumber,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import {
  IsStellarAddress,
  IsVintageYear,
  IsIpfsCid,
  IsMethodologyScore,
} from '../common/validators';

/**
 * Embedded coordinates sub-DTO.
 * Latitude: -90 to 90. Longitude: -180 to 180.
 */
export class CoordinatesDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}

/**
 * DTO used by the REST controller to create a project (without on-chain registration).
 *
 * Validation highlights:
 *  - ownerAddress / verifierAddress: valid Stellar G... keys via @IsStellarAddress
 *  - vintageYear: 1990 – current year + 1 via @IsVintageYear
 *  - methodologyScore: 0–100 integer via @IsMethodologyScore
 */
export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  methodology: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  description: string;

  @IsObject()
  @ValidateNested()
  @Type(() => CoordinatesDto)
  coordinates: CoordinatesDto;

  @IsArray()
  @IsString({ each: true })
  documents: string[];

  @IsString()
  @IsOptional()
  @MaxLength(64)
  country?: string;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  projectType?: string;

  /** Stellar public key of the project owner. */
  @IsStellarAddress()
  @IsOptional()
  ownerAddress?: string;

  /** Stellar public key of the assigned verifier. */
  @IsStellarAddress()
  @IsOptional()
  verifierAddress?: string;

  /** Vintage year of the project's expected credits (1990 – current year + 1). */
  @IsVintageYear()
  @IsOptional()
  @Type(() => Number)
  vintageYear?: number;

  /** Methodology quality score (0–100). Minimum 70 required for issuance. */
  @IsMethodologyScore()
  @IsOptional()
  @Type(() => Number)
  methodologyScore?: number;
}

/**
 * DTO for registering a project on-chain with the Soroban contract.
 *
 * All required fields for on-chain registration.
 */
export class RegisterProjectDto {
  @IsString()
  @Length(1, 64)
  projectId: string;

  @IsString()
  @Length(1, 128)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(1024)
  description?: string;

  @IsString()
  @Length(1, 64)
  methodology: string;

  @IsString()
  @Length(1, 64)
  country: string;

  @IsString()
  @Length(1, 64)
  projectType: string;

  /** IPFS CID (v0 or v1) of the project metadata document. */
  @IsIpfsCid()
  metadataCid: string;

  /** Stellar public key of the assigned verifier. */
  @IsStellarAddress()
  verifierAddress: string;

  /** Stellar public key of the project owner. */
  @IsStellarAddress()
  ownerAddress: string;

  /** Vintage year (1990 – current year + 1). */
  @IsVintageYear()
  @Type(() => Number)
  vintageYear: number;

  /** Methodology quality score (0–100). Minimum 70 required for issuance. */
  @IsMethodologyScore()
  @Type(() => Number)
  methodologyScore: number;
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
  CERTIFIED = 'Certified',
}

export enum OracleFreshness {
  FRESH = 'fresh',
  STALE = 'stale',
  UNKNOWN = 'unknown',
}

export class SearchProjectsDto {
  @IsString()
  @IsOptional()
  @MaxLength(128)
  search?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  methodology?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  country?: string[];

  @IsArray()
  @IsEnum(ProjectStatus, { each: true })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  status?: ProjectStatus[];

  @IsArray()
  @IsInt({ each: true })
  @Min(1990)
  @Max(new Date().getFullYear() + 1)
  @IsOptional()
  @Type(() => Number)
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  vintageYear?: number[];

  @IsEnum(OracleFreshness)
  @IsOptional()
  oracleFreshness?: OracleFreshness;

  @IsString()
  @IsOptional()
  @MaxLength(128)
  cursor?: string;

  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  @IsOptional()
  limit?: number = 20;

  @IsInt()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  offset?: number = 0;

  @IsString()
  @IsOptional()
  @MaxLength(32)
  sortBy?: 'createdAt' | 'vintageYear' | 'totalCreditsIssued' | 'name';

  @IsEnum(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}

export class PaginatedProjectsResponse {
  data: any[];
  projects: any[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset?: number | null;
  nextCursor?: string;
}

export class BatchCreateProjectsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProjectDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  items: CreateProjectDto[];
}

export class UpdateProjectStatusItemDto {
  @IsString()
  @Length(1, 64)
  projectId: string;

  @IsEnum(ProjectStatus)
  status: ProjectStatus;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}

export class BatchUpdateProjectStatusDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateProjectStatusItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  items: UpdateProjectStatusItemDto[];
}

