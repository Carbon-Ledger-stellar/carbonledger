import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationPreferencesDto {
  @IsBoolean() @IsOptional() projectApproved?: boolean;
  @IsBoolean() @IsOptional() creditsMinted?: boolean;
  @IsBoolean() @IsOptional() purchaseConfirmed?: boolean;
  @IsBoolean() @IsOptional() retirementConfirmed?: boolean;
}
