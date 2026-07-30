import {
  IsOptional,
  IsString,
  IsNumber,
  IsInt,
  Min,
  IsNotEmpty,
  MaxLength,
  Length,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsISO8601 } from 'class-validator';
import { IsCreditAmount, IsStellarAddress } from '../common/validators';

/**
 * DTO for recording a credit retirement.
 *
 * Validation:
 *  - batchId / projectId: non-empty, max 64 chars
 *  - amount: positive tCO₂e amount via @IsCreditAmount (≥ 0.01, ≤ 2dp)
 *  - beneficiary: non-empty, max 100 chars (company name or person)
 *  - retirementReason: non-empty, max 500 chars
 *  - retiredBy: valid Stellar G... key via @IsStellarAddress
 *  - txHash: non-empty Stellar transaction hash, max 128 chars
 */
export class RetireCreditsDto {
  @IsString()
  @Length(1, 64)
  batchId: string;

  @IsString()
  @Length(1, 64)
  projectId: string;

  /**
   * Credit amount in tCO₂e to retire.
   * Must be ≥ 0.01 and ≤ 1,000,000,000 with at most 2 decimal places.
   */
  @IsCreditAmount()
  @Type(() => Number)
  amount: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  beneficiary: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  retirementReason: string;

  /** Stellar public key of the account retiring the credits. */
  @IsStellarAddress()
  retiredBy: string;

  /** Stellar transaction hash of the on-chain retirement. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  txHash: string;
}

/**
 * DTO for filtering/exporting retirements with optional date range and filters.
 */
export class ExportRetirementsDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  methodology?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  country?: string;

  @IsOptional()
  @IsInt()
  @Min(1990)
  @Type(() => Number)
  vintageYear?: number;

  /** ISO 8601 date string for start of retirement date range. */
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  /** ISO 8601 date string for end of retirement date range. */
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  beneficiary?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  maxAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  projectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  batchId?: string;
}
