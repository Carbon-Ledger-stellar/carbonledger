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
} from "class-validator";
import { Type } from "class-transformer";
import { IsISO8601 } from "class-validator";

export class RetireCreditsDto {
  @IsString()
  @IsNotEmpty()
  batchId: string;

  @IsString()
  @IsNotEmpty()
  projectId: string;

  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  amount: number;

  @IsString()
  @IsNotEmpty()
  beneficiary: string;

  @IsString()
  @IsNotEmpty()
  retirementReason: string;

  @IsString()
  @IsNotEmpty()
  retiredBy: string;

  @IsString()
  @IsNotEmpty()
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
  methodology?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsInt()
  vintageYear?: number;

  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @IsOptional()
  @IsString()
  beneficiary?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxAmount?: number;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  batchId?: string;
}
