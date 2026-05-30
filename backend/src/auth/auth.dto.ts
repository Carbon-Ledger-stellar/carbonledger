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

export class RefreshDto {
  @IsString() refreshToken: string;
}
