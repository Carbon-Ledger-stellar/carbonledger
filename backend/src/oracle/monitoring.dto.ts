import { IsString, IsNumber, IsPositive, IsDateString, IsUrl, Length, MaxLength, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class SubmitMonitoringDataDto {
  @IsString()
  @Length(1, 64)
  project_id: string;

  @IsString()
  @Length(1, 64)
  satellite_provider: string;

  @IsUrl()
  @MaxLength(500)
  url: string;

  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  co2_reduction_mmt: number;

  @IsDateString()
  timestamp: string;

  @IsString()
  @IsOptional()
  @Length(1, 64)
  period?: string;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  methodology_score?: number;

  @IsString()
  @IsOptional()
  satellite_cid?: string;
}
