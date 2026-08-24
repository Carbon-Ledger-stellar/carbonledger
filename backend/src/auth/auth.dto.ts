import { IsString, IsIn, IsOptional } from 'class-validator';
import { UserRole } from './auth.service';

export class ChallengeDto {
  @IsString() publicKey: string;
}

export class VerifyDto {
  @IsString() publicKey: string;
  @IsString() signature: string;
  @IsString() nonce: string;
  @IsOptional()
  @IsIn(['project_developer', 'corporation', 'verifier', 'admin'])
  role?: UserRole;
}

/**
 * The refresh token may arrive either as an HTTP-only cookie (#892) or in
 * the body for API clients that do not use cookies.
 */
export class RefreshDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class LogoutDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
