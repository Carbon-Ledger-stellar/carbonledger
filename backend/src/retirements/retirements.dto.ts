import {
  IsOptional,
  IsString,
  IsNumber,
  IsInt,
  Min,
  Max,
  IsNotEmpty,
  IsPositive,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
  Length,
  MaxLength,
} from "class-validator";
import { Type } from "class-transformer";
import { IsISO8601 } from "class-validator";
import { IsCreditAmount,
         IsStellarAddress,
} from '../common/validators';

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

export class BulkRetirementItemDto {
  @IsString()
  @IsNotEmpty()
  batchId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Type(() => Number)
  amount: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  beneficiary?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reason?: string;
}

export class BulkRetirementsDto {
  @ValidateNested({ each: true })
  @Type(() => BulkRetirementItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  items: BulkRetirementItemDto[];

  @IsString()
  @IsNotEmpty()
  beneficiary: string;

  @IsString()
  @IsNotEmpty()
  retirementReason: string;
}

export class CsvBulkRetirementsDto {
  @IsString()
  @IsNotEmpty()
  csv: string;
}

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
