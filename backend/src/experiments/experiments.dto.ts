import { IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { ExperimentStatus } from './experiment-engine';

const STATUSES: ExperimentStatus[] = ['draft', 'running', 'paused', 'concluded'];

/** Body of POST /experiments/:key/events */
export class RecordMetricDto {
  @IsString()
  @Length(1, 64)
  metric: string;

  /** Required for continuous metrics; ignored for conversions. */
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  value?: number;
}

/** Body of PATCH /admin/experiments/:key */
export class UpdateExperimentDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: ExperimentStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  rolloutPercent?: number;

  @IsOptional()
  @IsString()
  winner?: string;
}
