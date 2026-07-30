import { IsString, IsOptional, Length, IsIn, IsInt, Min, Max } from 'class-validator';
import { IsStellarAddress } from '../common/validators';

/**
 * DTO for whitelisting a verifier address.
 *
 * Validation:
 *  - address: valid Stellar G... key via @IsStellarAddress
 */
export class VerifierWhitelistDto {
  /** Stellar public key of the verifier to whitelist. */
  @IsStellarAddress()
  address: string;
}

/**
 * DTO for updating the treasury address.
 *
 * Validation:
 *  - address: valid Stellar G... key via @IsStellarAddress
 */
export class UpdateTreasuryDto {
  /** Stellar public key of the new treasury account. */
  @IsStellarAddress()
  address: string;
}

/**
 * DTO for assigning a role to a user.
 *
 * Validation:
 *  - role: must be one of the defined roles
 */
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
