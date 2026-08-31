import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

/**
 * Validates that a serial number string represents a non-negative integer
 * within the valid u64 range  [0, 9_007_199_254_740_991] (safe JS integer bound).
 *
 * Serial numbers are stored as strings to avoid JS number precision loss
 * on very large values.
 */
@ValidatorConstraint({ name: 'IsSerialNumber', async: false })
export class IsSerialNumberConstraint implements ValidatorConstraintInterface {
  private static readonly SERIAL_REGEX = /^[0-9]+$/;
  /** Max safe integer in JavaScript (2^53 − 1) */
  private static readonly MAX_SAFE = 9_007_199_254_740_991n;

  validate(value: unknown, _args?: ValidationArguments): boolean {
    if (typeof value !== 'string') return false;
    if (!IsSerialNumberConstraint.SERIAL_REGEX.test(value)) return false;
    if (value.length > 16) return false; // Quick guard before BigInt parse
    try {
      const n = BigInt(value);
      return n >= 0n && n <= IsSerialNumberConstraint.MAX_SAFE;
    } catch {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a non-negative integer string within the safe range [0, 9007199254740991]`;
  }
}

/**
 * Decorator: validates that a string field is a valid serial number integer.
 */
export function IsSerialNumber(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'IsSerialNumber',
      target: (object as any).constructor,
      propertyName: propertyName as string,
      options,
      validator: IsSerialNumberConstraint,
    });
  };
}

/**
 * Cross-field validator: validates that serialEnd >= serialStart when both
 * are provided on the same DTO instance.
 *
 * Usage (on the class, not a property):
 *
 *   @ValidateSerialRange()
 *   class MintCreditsDto { serialStart: string; serialEnd: string; }
 */
@ValidatorConstraint({ name: 'ValidSerialRange', async: false })
export class ValidSerialRangeConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args?: ValidationArguments): boolean {
    if (!args) return true;
    const { serialStart, serialEnd } = args.object as Record<string, unknown>;
    if (typeof serialStart !== 'string' || typeof serialEnd !== 'string') return true;
    if (!/^[0-9]+$/.test(serialStart) || !/^[0-9]+$/.test(serialEnd)) return true;
    try {
      return BigInt(serialEnd) >= BigInt(serialStart);
    } catch {
      return true; // defer to IsSerialNumber for format errors
    }
  }

  defaultMessage(_args?: ValidationArguments): string {
    return 'serialEnd must be greater than or equal to serialStart';
  }
}

/**
 * Class-level decorator ensuring serialEnd >= serialStart on a DTO.
 *
 * Apply it to the class, not a property:
 *
 *   @ValidateSerialRange()
 *   export class MintCreditsDto { ... }
 */
export function ValidateSerialRange(options?: ValidationOptions): ClassDecorator {
  return (target: Function) => {
    registerDecorator({
      name: 'ValidSerialRange',
      target: target as any,
      propertyName: 'serialEnd',
      options,
      validator: ValidSerialRangeConstraint,
    });
  };
}
