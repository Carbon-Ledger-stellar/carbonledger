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

/**
 * DTO for reviewing a quarantined satellite submission (#579).
 *
 * Validation:
 *  - decision: approved (data is legitimate, release for resubmission) or
 *              rejected (data is bad, discard)
 *  - note: free-text rationale recorded alongside the decision
 */
export class ReviewQuarantineDto {
  @IsString()
  @IsIn(['approved', 'rejected'])
  decision: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  note?: string;
}

/**
 * DTO for admin soft-delete of a project/credit batch/retirement (#964).
 *
 * Validation:
 *  - reason: optional free-text rationale, recorded in the audit log
 */
export class SoftDeleteDto {
  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
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
