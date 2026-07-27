import { IsOptional, IsString, IsNumber, IsDate, IsInt, Min, Max, IsNotEmpty, IsPositive } from "class-validator";
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
