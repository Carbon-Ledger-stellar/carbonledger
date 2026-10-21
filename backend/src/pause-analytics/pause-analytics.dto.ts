import { IsIn, IsISO8601, IsOptional, IsString, Length, Matches } from 'class-validator';
import { PAUSE_ACTIONS, PAUSE_CONTRACTS, PauseAction, PauseContract } from './pause-analytics.types';

/** Body of POST /admin/pause-analytics/events — records why a pause happened. */
export class RecordPauseReasonDto {
  @IsIn(PAUSE_CONTRACTS)
  contract: PauseContract;

  @IsIn(PAUSE_ACTIONS)
  action: PauseAction;

  /** Hash of the pause_operations / unpause_operations transaction. */
  @Matches(/^[a-f0-9]{64}$/i, { message: 'txHash must be a 64-character hex transaction hash' })
  txHash: string;

  @IsString()
  @Length(3, 500)
  reason: string;

  /** The until_timestamp passed to pause_operations, as ISO-8601. */
  @IsOptional()
  @IsISO8601()
  pausedUntil?: string;
}

/** Query string shared by summary, report and export. */
export class PauseAnalyticsQueryDto {
  /** ISO-8601; defaults to 30 days before `to`. */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** ISO-8601; defaults to now. */
  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsIn(PAUSE_CONTRACTS)
  contract?: PauseContract;
}

export class PauseExportQueryDto extends PauseAnalyticsQueryDto {
  @IsOptional()
  @IsIn(['csv', 'json'])
  format?: 'csv' | 'json';
}
