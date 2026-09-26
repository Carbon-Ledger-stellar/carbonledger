import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

/**
 * Validates a Stellar public key (account address).
 *
 * Rules:
 *  - Must start with 'G'
 *  - Must be exactly 56 characters
 *  - Must use Stellar's base32 alphabet (A-Z, 2-7)
 */
@ValidatorConstraint({ name: 'IsStellarAddress', async: false })
export class IsStellarAddressConstraint implements ValidatorConstraintInterface {
  // Stellar public key regex: G + 55 base32 characters (A–Z and 2–7)
  private static readonly STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;

  validate(value: unknown, _args?: ValidationArguments): boolean {
    if (typeof value !== 'string') return false;
    return IsStellarAddressConstraint.STELLAR_ADDRESS_REGEX.test(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a valid Stellar public key (starts with G, 56 characters, base32 alphabet)`;
  }
}

/**
 * Decorator: validates that a string is a valid Stellar public address (G...).
 */
export function IsStellarAddress(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'IsStellarAddress',
      target: (object as any).constructor,
      propertyName: propertyName as string,
      options,
      validator: IsStellarAddressConstraint,
    });
  };
}
