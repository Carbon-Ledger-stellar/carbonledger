import { IsString, IsOptional, Length, IsIn, IsInt, Min, Max } from 'class-validator';

export class VerifierWhitelistDto {
  @IsString() @Length(56, 56) address: string; // Stellar public key (G...)
}

export class UpdateTreasuryDto {
  @IsString() @Length(56, 56) address: string;
}

export class AssignRoleDto {
  @IsString()
  @IsIn(['admin', 'verifier', 'project_developer', 'corporation'])
  role: string;
}

export class UpdateCanaryDto {
  /**
   * Canary contract address (Stellar contract ID, 56-char C... address).
   * Pass an empty string or omit to clear the canary contract and disable routing.
   */
  @IsOptional()
  @IsString()
  @Length(0, 56)
  canaryContractId?: string;

  /**
   * Percentage of contract calls to route to the canary (0–100).
   * 0 disables canary traffic; 100 fully migrates to the canary.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  trafficPct?: number;
}
