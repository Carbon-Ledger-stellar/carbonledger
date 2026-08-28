import { IsString, IsEmail, IsIn, IsOptional, MaxLength } from 'class-validator';
import { IsStellarAddress } from '../common/validators';

/**
 * DTO for a verifier applying for accreditation.
 *
 * Validation:
 *  - publicKey: valid Stellar G... key via @IsStellarAddress
 *  - organizationName / accreditationBody / accreditationId: non-empty strings
 *  - contactEmail: valid email format
 *  - documentsCid: non-empty string (IPFS CID uploaded by client before calling)
 */
export class ApplyVerifierDto {
  /** Stellar public key of the verifier's account. */
  @IsStellarAddress()
  publicKey: string;

  @IsString()
  @MaxLength(128)
  organizationName: string;

  @IsString()
  @MaxLength(128)
  accreditationBody: string;

  @IsString()
  @MaxLength(64)
  accreditationId: string;

  @IsEmail()
  contactEmail: string;

  /** IPFS CID of the verifier's accreditation documents. */
  @IsString()
  documentsCid: string;
}

/**
 * DTO for an admin reviewing a verifier application.
 *
 * Validation:
 *  - adminPublicKey: valid Stellar G... key via @IsStellarAddress
 *  - decision: must be 'approved' or 'rejected'
 *  - rejectionReason: required when decision is 'rejected'
 */
export class ReviewVerifierDto {
  /** Stellar public key of the admin performing the review. */
  @IsStellarAddress()
  adminPublicKey: string;

  @IsString()
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';

  @IsString()
  @IsOptional()
  @MaxLength(500)
  rejectionReason?: string;
}
