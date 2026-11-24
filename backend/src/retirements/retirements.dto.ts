import {
  IsOptional,
  IsString,
  IsNumber,
  IsInt,
  Min,
  Max,
  Length,
  MaxLength,
  IsNotEmpty,
  IsPositive,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { IsISO8601 } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsCreditAmount, IsStellarAddress, IsSafeString, IsTxHash } from "../common/validators";

export class RetireCreditsDto {
  @ApiProperty({
    description: "Identifier of the credit batch to retire",
    example: "batch_kenya_reforest_2024_01",
    maxLength: 64,
  })
  @IsString()
  @Length(1, 64)
  batchId: string;

  @ApiProperty({
    description: "Unique project identifier",
    example: "proj_amazon_basin_042",
    maxLength: 64,
  })
  @IsString()
  @Length(1, 64)
  projectId: string;

  /**
   * Credit amount in tCO₂e to retire.
   * Must be ≥ 0.01 and ≤ 1,000,000,000 with at most 2 decimal places.
   */
  @ApiProperty({
    description: "Credit amount in tCO2e to permanently retire",
    example: 125.5,
    minimum: 0.01,
    maximum: 1000000000,
  })
  @IsCreditAmount()
  @Type(() => Number)
  amount: number;

  @ApiProperty({
    description: "Entity or individual on whose behalf credits are retired",
    example: "Acme Global Corporation",
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @IsSafeString()
  beneficiary: string;

  @ApiProperty({
    description: "Reason or compliance reporting justification for the retirement",
    example: "Annual corporate Scope 1 & 2 carbon footprint offset FY2025",
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @IsSafeString()
  retirementReason: string;

  /** Stellar public key of the account retiring the credits. */
  @ApiProperty({
    description: "Stellar public key of the account retiring the credits",
    example: "GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF",
  })
  @IsStellarAddress()
  retiredBy: string;

  /** Stellar transaction hash of the on-chain retirement. */
  @ApiProperty({
    description: "Stellar transaction hash of the on-chain retirement call",
    example: "a1b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890abcdef",
  })
  @IsString()
  @IsNotEmpty()
  @IsTxHash()
  txHash: string;
}

export class BulkRetirementItemDto {
  @ApiProperty({
    description: "Batch identifier",
    example: "batch_kenya_reforest_2024_01",
  })
  @IsString()
  @IsNotEmpty()
  batchId: string;

  @ApiProperty({
    description: "Amount of credits from this batch to retire",
    example: 25.0,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Type(() => Number)
  amount: number;

  @ApiPropertyOptional({
    description: "Optional item-specific beneficiary overriding parent",
    example: "Acme Regional Office - London",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  beneficiary?: string;

  @ApiPropertyOptional({
    description: "Optional item-specific retirement reason",
    example: "London flight emissions offset",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reason?: string;
}

export class BulkRetirementsDto {
  @ApiProperty({
    description: "List of retirement line items",
    type: [BulkRetirementItemDto],
  })
  @ValidateNested({ each: true })
  @Type(() => BulkRetirementItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  items: BulkRetirementItemDto[];

  @ApiProperty({
    description: "Default beneficiary for all items lacking an override",
    example: "Acme Global Corporation",
  })
  @IsString()
  @IsNotEmpty()
  beneficiary: string;

  @ApiProperty({
    description: "Default retirement reason for all items lacking an override",
    example: "Corporate Sustainability Initiative Q1 2026",
  })
  @IsString()
  @IsNotEmpty()
  retirementReason: string;
}

export class CsvBulkRetirementsDto {
  @ApiProperty({
    description: "Raw CSV string with columns: batchId, amount, beneficiary, reason",
    example: "batchId,amount,beneficiary,reason\nbatch_001,10.5,Branch North,Data Center Offset\nbatch_002,20.0,Branch South,Logistics Offset",
  })
  @IsString()
  @IsNotEmpty()
  csv: string;
}

export class ExportRetirementsDto {
  @ApiPropertyOptional({
    description: "Filter by methodology",
    example: "VM0007",
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  methodology?: string;

  @ApiPropertyOptional({
    description: "Filter by country code (ISO 3166-1 alpha-2)",
    example: "KE",
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  country?: string;

  @ApiPropertyOptional({
    description: "Filter by vintage year",
    example: 2024,
    minimum: 1990,
  })
  @IsOptional()
  @IsInt()
  @Min(1990)
  @Type(() => Number)
  vintageYear?: number;

  /** ISO 8601 date string for start of retirement date range. */
  @ApiPropertyOptional({
    description: "ISO 8601 start date filter",
    example: "2024-01-01T00:00:00Z",
  })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  /** ISO 8601 date string for end of retirement date range. */
  @ApiPropertyOptional({
    description: "ISO 8601 end date filter",
    example: "2024-12-31T23:59:59Z",
  })
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiPropertyOptional({
    description: "Filter by beneficiary name",
    example: "Acme Corp",
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  beneficiary?: string;

  @ApiPropertyOptional({
    description: "Minimum retired credit amount",
    example: 10.0,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minAmount?: number;

  @ApiPropertyOptional({
    description: "Maximum retired credit amount",
    example: 500.0,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  maxAmount?: number;

  @ApiPropertyOptional({
    description: "Filter by project ID",
    example: "proj_amazon_basin_042",
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  projectId?: string;

  @ApiPropertyOptional({
    description: "Filter by batch ID",
    example: "batch_kenya_reforest_2024_01",
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  batchId?: string;
}

export class RetirementsQueryDto {
  @ApiPropertyOptional({
    description: "Search keyword matching project name, beneficiary or reason",
    example: "reforestation",
  })
  @IsOptional() @IsString() search?: string;

  @ApiPropertyOptional({
    description: "Filter by project ID",
    example: "proj_amazon_basin_042",
  })
  @IsOptional() @IsString() projectId?: string;

  @ApiPropertyOptional({
    description: "Filter by vintage year",
    example: 2024,
    minimum: 1990,
  })
  @IsOptional() @IsInt() @Min(1990) @Type(() => Number) vintageYear?: number;

  @ApiPropertyOptional({
    description: "Pagination cursor",
    example: "cursor_token_xyz123",
  })
  @IsOptional() @IsString() cursor?: string;

  @ApiPropertyOptional({
    description: "Maximum number of records to return",
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional() @IsInt() @Min(1) @Max(100) @Type(() => Number) limit?: number = 20;

  @ApiPropertyOptional({
    description: "Pagination offset",
    default: 0,
    minimum: 0,
  })
  @IsOptional() @IsInt() @Min(0) @Type(() => Number) offset?: number = 0;
}
