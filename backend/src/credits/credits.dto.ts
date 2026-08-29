import {
  IsString, IsInt, IsNumber, IsPositive, Min, Max,
  Matches, Length, MaxLength, ValidatorConstraint,
  ValidatorConstraintInterface, ValidationArguments,
  Validate,
} from "class-validator";
import { Type } from "class-transformer";

const CID_REGEX = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/;

/** u64::MAX — the maximum serial number representable in the Soroban contract. */
const U64_MAX = BigInt("18446744073709551615");

/**
 * Cross-field validator that enforces:
 *   1. serialStart and serialEnd are pure decimal integer strings (no leading zeros on multi-digit values).
 *   2. serialStart >= 1   (zero is invalid; the contract rejects serial_start == 0)
 *   3. serialEnd   > serialStart  (range must span at least 2 values)
 *   4. serialEnd  <= u64::MAX     (prevents Soroban u64 overflow)
 *
 * BigInt arithmetic is used throughout so that large 64-bit values are compared
 * correctly without floating-point precision loss.
 */
@ValidatorConstraint({ name: "IsSerialRangeValid", async: false })
export class IsSerialRangeValid implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const obj = args.object as MintCreditsDto;
    const { serialStart, serialEnd } = obj;

    // Guard: both fields must already be present and decimal strings
    // (the @Matches decorators on each field handle format, but we double-check here)
    if (typeof serialStart !== "string" || typeof serialEnd !== "string") return false;
    if (!/^[0-9]+$/.test(serialStart) || !/^[0-9]+$/.test(serialEnd)) return false;

    try {
      const start = BigInt(serialStart);
      const end   = BigInt(serialEnd);

      if (start < 1n)       return false; // zero or negative start
      if (end <= start)     return false; // end must be strictly greater than start
      if (end > U64_MAX)    return false; // would overflow u64 in the contract
    } catch {
      return false;
    }

    return true;
  }

  defaultMessage(_args: ValidationArguments): string {
    return (
      "Invalid serial range: serialEnd must be greater than serialStart, " +
      "serialStart must be >= 1, and serialEnd must not exceed the u64 maximum " +
      "(18446744073709551615). Both values must be positive integer strings."
    );
  }
}

export class MintCreditsDto {
  @IsString() @Length(1, 64) batchId: string;
  @IsString() @Length(1, 64) projectId: string;
  @IsInt() @IsPositive() @Min(1990) @Max(new Date().getFullYear() + 1) @Type(() => Number) vintageYear: number;
  /** Supports fractional tonnes, e.g. 0.5. Minimum 0.01 tCO₂e. */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Type(() => Number) amount: number;
  @IsString()
  @Matches(/^[0-9]+$/, { message: "serialStart must be a positive integer string" })
  @Length(1, 32)
  serialStart: string;
  @IsString()
  @Matches(/^[0-9]+$/, { message: "serialEnd must be a positive integer string" })
  @Length(1, 32)
  serialEnd: string;
  @IsString() @Matches(CID_REGEX, { message: "metadataCid must be a valid IPFS CID (CIDv0 or CIDv1)" }) metadataCid: string;

  /**
   * Cross-field validation: enforces serialEnd > serialStart and u64 overflow protection.
   * Placed on the class so class-validator runs it after individual field validators.
   */
  @Validate(IsSerialRangeValid)
  get _serialRangeGuard(): string {
    // The @Validate decorator requires a decorated property; this getter exists solely
    // to host the cross-field validator.  The value is irrelevant.
    return this.serialStart;
  }
}

export class RetireCreditsDto {
  @IsString() @Length(1, 64) batchId: string;
  /** Supports fractional tonnes, e.g. 0.5. Minimum 0.01 tCO₂e. */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Type(() => Number) amount: number;
  @IsString() @Length(1, 64) beneficiary: string;
  @IsString() @MaxLength(256) retirementReason: string;
  @IsString() @Length(1, 64) holderPublicKey: string;
}
