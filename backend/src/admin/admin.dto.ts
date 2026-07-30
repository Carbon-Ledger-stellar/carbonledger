import { IsString, IsIn, IsOptional } from 'class-validator';
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
