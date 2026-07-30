import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

/** Earliest year a carbon credit vintage is considered valid. */
const VINTAGE_YEAR_MIN = 1990;

/**
 * Validates that a vintage year is a four-digit integer between
 * VINTAGE_YEAR_MIN (1990) and current year + 1 (one year ahead for
 * forward-dated issuance).
 */
@ValidatorConstraint({ name: 'IsVintageYear', async: false })
export class IsVintageYearConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, _args?: ValidationArguments): boolean {
    if (typeof value !== 'number' || !Number.isInteger(value)) return false;
    const maxYear = new Date().getFullYear() + 1;
    return value >= VINTAGE_YEAR_MIN && value <= maxYear;
  }

  defaultMessage(args: ValidationArguments): string {
    const maxYear = new Date().getFullYear() + 1;
    return `${args.property} must be a valid vintage year between ${VINTAGE_YEAR_MIN} and ${maxYear}`;
  }
}

/**
 * Decorator: validates that a number field is a valid carbon credit vintage year.
 * Valid range: 1990 – (current year + 1).
 */
export function IsVintageYear(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'IsVintageYear',
      target: (object as any).constructor,
      propertyName: propertyName as string,
      options,
      validator: IsVintageYearConstraint,
    });
  };
}

/**
 * Validates that a credit amount is a positive number with at most 2 decimal
 * places and meets the minimum threshold of 0.01 tCO₂e.
 */
@ValidatorConstraint({ name: 'IsCreditAmount', async: false })
export class IsCreditAmountConstraint implements ValidatorConstraintInterface {
  private static readonly MIN_AMOUNT = 0.01;
  private static readonly MAX_AMOUNT = 1_000_000_000; // 1 billion tCO₂e cap per batch

  validate(value: unknown, _args?: ValidationArguments): boolean {
    if (typeof value !== 'number' || isNaN(value)) return false;
    if (value < IsCreditAmountConstraint.MIN_AMOUNT) return false;
    if (value > IsCreditAmountConstraint.MAX_AMOUNT) return false;
    // Enforce at most 2 decimal places
    const str = value.toString();
    const dotIndex = str.indexOf('.');
    if (dotIndex !== -1 && str.length - dotIndex - 1 > 2) return false;
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a positive number between 0.01 and 1,000,000,000 with at most 2 decimal places (tCO₂e)`;
  }
}

/**
 * Decorator: validates that a field is a valid carbon credit amount (tCO₂e).
 * Minimum: 0.01, Maximum: 1,000,000,000, at most 2 decimal places.
 */
export function IsCreditAmount(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'IsCreditAmount',
      target: (object as any).constructor,
      propertyName: propertyName as string,
      options,
      validator: IsCreditAmountConstraint,
    });
  };
}

/**
 * Validates that a string is a valid IPFS CID (v0 or v1).
 *  - CIDv0: starts with "Qm", 46 characters total, base58btc
 *  - CIDv1: starts with "b", encoded with base32 (bafy... / bafk...)
 */
@ValidatorConstraint({ name: 'IsIpfsCid', async: false })
export class IsIpfsCidConstraint implements ValidatorConstraintInterface {
  private static readonly CID_REGEX = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/;

  validate(value: unknown, _args?: ValidationArguments): boolean {
    if (typeof value !== 'string') return false;
    return IsIpfsCidConstraint.CID_REGEX.test(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a valid IPFS CID (CIDv0 starting with 'Qm' or CIDv1 starting with 'b')`;
  }
}

/**
 * Decorator: validates that a string field is a valid IPFS CID (v0 or v1).
 */
export function IsIpfsCid(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'IsIpfsCid',
      target: (object as any).constructor,
      propertyName: propertyName as string,
      options,
      validator: IsIpfsCidConstraint,
    });
  };
}

/**
 * Validates that a methodology score is an integer between 0 and 100.
 * Score minimum for credit issuance is 70 (enforced at service layer, but
 * the validator ensures the incoming value is in the valid range).
 */
@ValidatorConstraint({ name: 'IsMethodologyScore', async: false })
export class IsMethodologyScoreConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, _args?: ValidationArguments): boolean {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be an integer between 0 and 100`;
  }
}

/**
 * Decorator: validates that a field is a valid methodology score (0–100).
 */
export function IsMethodologyScore(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'IsMethodologyScore',
      target: (object as any).constructor,
      propertyName: propertyName as string,
      options,
      validator: IsMethodologyScoreConstraint,
    });
  };
}
