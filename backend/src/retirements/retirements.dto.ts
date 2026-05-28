import { IsOptional, IsString, IsNumber, IsDate, IsInt, Min, Max } from "class-validator";
import { Type } from "class-transformer";
import { IsISO8601 } from "class-validator";

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
