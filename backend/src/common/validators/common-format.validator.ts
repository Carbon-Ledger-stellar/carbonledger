import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

// ── IsSafeString ──────────────────────────────────────────────────────────────

/**
 * Validates that a string contains no XSS attack patterns.
 *
 * Blocks:
 *  - HTML tags: <script>, <img>, <iframe>, etc.
 *  - JavaScript/data URI schemes: javascript:, data:, vbscript:
 *  - DOM event handlers: onclick, onerror, onload, etc.
 *  - HTML entity encodings of the above
 *
 * Issue #1075: Input Validation & Sanitization — OWASP A03 Injection.
 */
@ValidatorConstraint({ name: 'IsSafeString', async: false })
export class IsSafeStringConstraint implements ValidatorConstraintInterface {
  private static readonly XSS_PATTERNS = [
    /<[a-z][\s\S]*>/i,                   // any HTML tag
    /javascript\s*:/i,                    // javascript: URI
    /vbscript\s*:/i,                      // vbscript: URI
    /data\s*:\s*text\/html/i,             // data:text/html URI
    /on\w+\s*=/i,                         // event handlers (onclick=, onerror=, …)
    /&#x?[0-9a-f]+;/i,                   // HTML numeric entity encoding
    /<\s*script/i,                        // <script (with possible whitespace)
    /<\s*\/\s*script/i,                   // </script>
    /expression\s*\(/i,                   // CSS expression()
  ];

  validate(value: unknown, _args?: ValidationArguments): boolean {
    if (typeof value !== 'string') return false;
    return !IsSafeStringConstraint.XSS_PATTERNS.some((re) => re.test(value));
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} contains potentially unsafe content (HTML tags, script injection, or event handlers are not allowed).`;
  }
}

/** Validates that a string is free of XSS attack patterns. */
export function IsSafeString(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'IsSafeString',
      target: (object as any).constructor,
      propertyName: propertyName as string,
      options,
      validator: IsSafeStringConstraint,
    });
  };
}

// ── IsTxHash ──────────────────────────────────────────────────────────────────

/**
 * Validates a Stellar transaction hash.
 * A Stellar tx hash is a 64-character lowercase hex string.
 */
@ValidatorConstraint({ name: 'IsTxHash', async: false })
export class IsTxHashConstraint implements ValidatorConstraintInterface {
  private static readonly TX_HASH_REGEX = /^[a-fA-F0-9]{64}$/;

  validate(value: unknown, _args?: ValidationArguments): boolean {
    if (typeof value !== 'string') return false;
    return IsTxHashConstraint.TX_HASH_REGEX.test(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a valid Stellar transaction hash (64 hexadecimal characters).`;
  }
}

/** Validates a Stellar transaction hash (64 hex chars). */
export function IsTxHash(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'IsTxHash',
      target: (object as any).constructor,
      propertyName: propertyName as string,
      options,
      validator: IsTxHashConstraint,
    });
  };
}

// ── IsSafeUrl ─────────────────────────────────────────────────────────────────

/**
 * Validates that a URL uses only http or https schemes.
 * Blocks javascript:, data:, ftp:, vbscript:, and any other scheme.
 *
 * Issue #1075: OWASP A03 — prevents open-redirect and URL injection attacks.
 */
@ValidatorConstraint({ name: 'IsSafeUrl', async: false })
export class IsSafeUrlConstraint implements ValidatorConstraintInterface {
  private static readonly ALLOWED_SCHEME = /^https?:\/\//i;
  private static readonly BLOCKED_SCHEMES = /^(javascript|data|vbscript|ftp|file):/i;

  validate(value: unknown, _args?: ValidationArguments): boolean {
    if (typeof value !== 'string') return false;
    if (IsSafeUrlConstraint.BLOCKED_SCHEMES.test(value.trim())) return false;
    if (!IsSafeUrlConstraint.ALLOWED_SCHEME.test(value.trim())) return false;
    try {
      const url = new URL(value.trim());
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a valid http or https URL (javascript:, data:, and ftp: schemes are not allowed).`;
  }
}

/** Validates that a string is a safe http/https URL. */
export function IsSafeUrl(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'IsSafeUrl',
      target: (object as any).constructor,
      propertyName: propertyName as string,
      options,
      validator: IsSafeUrlConstraint,
    });
  };
}

// ── IsIpfsUrl ─────────────────────────────────────────────────────────────────

/**
 * Validates that a string is a valid IPFS URL.
 * Accepts: ipfs://<CID> or https://ipfs.io/ipfs/<CID>
 */
@ValidatorConstraint({ name: 'IsIpfsUrl', async: false })
export class IsIpfsUrlConstraint implements ValidatorConstraintInterface {
  private static readonly IPFS_URL_REGEX =
    /^(ipfs:\/\/[a-zA-Z0-9]+|https:\/\/ipfs\.io\/ipfs\/[a-zA-Z0-9]+)(\/.*)?$/;

  validate(value: unknown, _args?: ValidationArguments): boolean {
    if (typeof value !== 'string') return false;
    return IsIpfsUrlConstraint.IPFS_URL_REGEX.test(value.trim());
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a valid IPFS URL (ipfs://<CID> or https://ipfs.io/ipfs/<CID>).`;
  }
}

/** Validates that a string is a valid IPFS URL. */
export function IsIpfsUrl(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'IsIpfsUrl',
      target: (object as any).constructor,
      propertyName: propertyName as string,
      options,
      validator: IsIpfsUrlConstraint,
    });
  };
}

// ── IsNonNegativeAmount ───────────────────────────────────────────────────────

/**
 * Validates that a number is non-negative (≥ 0) with at most 2 decimal places.
 * Used for displaying/querying amounts where zero is valid (unlike credit
 * creation amounts which must be ≥ 0.01).
 */
@ValidatorConstraint({ name: 'IsNonNegativeAmount', async: false })
export class IsNonNegativeAmountConstraint implements ValidatorConstraintInterface {
  private static readonly MAX_AMOUNT = 1_000_000_000;

  validate(value: unknown, _args?: ValidationArguments): boolean {
    if (typeof value !== 'number' || isNaN(value)) return false;
    if (value < 0) return false;
    if (value > IsNonNegativeAmountConstraint.MAX_AMOUNT) return false;
    const str = value.toString();
    const dotIndex = str.indexOf('.');
    if (dotIndex !== -1 && str.length - dotIndex - 1 > 2) return false;
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a non-negative number with at most 2 decimal places (max 1,000,000,000).`;
  }
}

/** Validates a non-negative decimal amount (0 – 1,000,000,000, ≤2 d.p.). */
export function IsNonNegativeAmount(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'IsNonNegativeAmount',
      target: (object as any).constructor,
      propertyName: propertyName as string,
      options,
      validator: IsNonNegativeAmountConstraint,
    });
  };
}

// ── IsMethodologyId ───────────────────────────────────────────────────────────

/**
 * Validates a carbon methodology identifier.
 * Allows: letters, digits, hyphens, underscores, dots, and forward slashes.
 * Max 64 characters.
 *
 * Typical values: "VCS-VM0007", "GS-LUF", "CDM-AR-ACM0003"
 */
@ValidatorConstraint({ name: 'IsMethodologyId', async: false })
export class IsMethodologyIdConstraint implements ValidatorConstraintInterface {
  private static readonly METHODOLOGY_REGEX = /^[a-zA-Z0-9\-_.\/]{1,64}$/;

  validate(value: unknown, _args?: ValidationArguments): boolean {
    if (typeof value !== 'string') return false;
    return IsMethodologyIdConstraint.METHODOLOGY_REGEX.test(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a valid methodology identifier (letters, numbers, hyphens, underscores, dots, max 64 characters).`;
  }
}

/** Validates a carbon methodology ID format. */
export function IsMethodologyId(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'IsMethodologyId',
      target: (object as any).constructor,
      propertyName: propertyName as string,
      options,
      validator: IsMethodologyIdConstraint,
    });
  };
}

// ── IsCarbonEmail ─────────────────────────────────────────────────────────────

/**
 * Validates an email address with a max length of 255 characters.
 * Uses a standard RFC 5322-aligned regex pattern.
 *
 * Issue #1075: OWASP A03 — input validation for email fields.
 */
@ValidatorConstraint({ name: 'IsCarbonEmail', async: false })
export class IsCarbonEmailConstraint implements ValidatorConstraintInterface {
  // Simplified RFC 5322 pattern — avoids catastrophic backtracking
  private static readonly EMAIL_REGEX =
    /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  private static readonly MAX_LENGTH = 255;

  validate(value: unknown, _args?: ValidationArguments): boolean {
    if (typeof value !== 'string') return false;
    if (value.length > IsCarbonEmailConstraint.MAX_LENGTH) return false;
    return IsCarbonEmailConstraint.EMAIL_REGEX.test(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a valid email address (max 255 characters).`;
  }
}

/** Validates an email address with a 255-character limit. */
export function IsCarbonEmail(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'IsCarbonEmail',
      target: (object as any).constructor,
      propertyName: propertyName as string,
      options,
      validator: IsCarbonEmailConstraint,
    });
  };
}
