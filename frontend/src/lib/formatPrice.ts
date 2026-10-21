/**
 * Format USDC prices consistently across the app.
 *
 * USDC on Stellar uses 7 decimal places. Display values are rounded to 2
 * decimals, while the full 7-decimal precision is available for tooltips.
 *
 * All math is done on strings / BigInt to avoid floating-point rounding
 * errors (e.g. 0.1 + 0.2 !== 0.3).
 */

const STELLAR_DECIMALS = 7;
const DISPLAY_DECIMALS = 2;

/**
 * Normalize an arbitrary price input (string, number, bigint) into a
 * canonical decimal string with exactly `STELLAR_DECIMALS` fractional digits.
 *
 * Numbers are converted via their string representation; callers that need
 * exact precision should pass strings or bigints.
 */
function toScaledString(value: string | number | bigint): string {
  let raw: string;

  if (typeof value === 'bigint') {
    raw = value.toString();
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return '0';
    }
    raw = value.toString();
  } else {
    raw = value.trim();
  }

  if (raw === '' || raw === '-' || raw === '.') {
    return '0';
  }

  const negative = raw.startsWith('-');
  if (negative) {
    raw = raw.slice(1);
  }

  // Support scientific notation (e.g. 1e-7) by expanding it.
  if (/[eE]/.test(raw)) {
    const num = Number(raw);
    if (!Number.isFinite(num)) {
      return '0';
    }
    raw = num.toFixed(STELLAR_DECIMALS);
  }

  const [intPartRaw = '0', fracPartRaw = ''] = raw.split('.');
  const intPart = intPartRaw.replace(/\D/g, '') || '0';
  const fracPart = fracPartRaw.replace(/\D/g, '');

  const paddedFrac = (fracPart + '0'.repeat(STELLAR_DECIMALS)).slice(
    0,
    STELLAR_DECIMALS,
  );

  const combined = `${intPart}${paddedFrac}`.replace(/^0+(?=\d)/, '') || '0';

  return negative && combined !== '0' ? `-${combined}` : combined;
}

/**
 * Round a scaled integer string (units of 1e-7) to `decimals` places using
 * half-up rounding, entirely with BigInt math.
 */
function roundScaled(scaled: string, decimals: number): string {
  const value = BigInt(scaled);
  const negative = value < 0n;
  const abs = negative ? -value : value;

  const drop = STELLAR_DECIMALS - decimals;
  if (drop <= 0) {
    return value.toString();
  }

  const factor = 10n ** BigInt(drop);
  const quotient = abs / factor;
  const remainder = abs % factor;
  const half = factor / 2n;
  const rounded = remainder >= half ? quotient + 1n : quotient;

  return (negative ? -rounded : rounded).toString();
}

/**
 * Insert a decimal point into a scaled integer string.
 */
function insertDecimal(scaled: string, decimals: number): string {
  const negative = scaled.startsWith('-');
  const digits = negative ? scaled.slice(1) : scaled;

  if (decimals === 0) {
    return `${negative ? '-' : ''}${digits}`;
  }

  const padded = digits.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals);

  return `${negative ? '-' : ''}${intPart}.${fracPart}`;
}

/**
 * Format a USDC price for display with 2 decimal places.
 *
 * @example formatPrice('1.2345678') // '1.23'
 * @example formatPrice(2) // '2.00'
 */
export function formatPrice(value: string | number | bigint): string {
  const scaled = toScaledString(value);
  const rounded = roundScaled(scaled, DISPLAY_DECIMALS);
  return insertDecimal(rounded, DISPLAY_DECIMALS);
}

/**
 * Format a USDC price with full 7-decimal Stellar precision, suitable for
 * tooltips and detail views.
 *
 * @example formatPriceFull('1.2345678') // '1.2345678'
 * @example formatPriceFull(2) // '2.0000000'
 */
export function formatPriceFull(value: string | number | bigint): string {
  const scaled = toScaledString(value);
  return insertDecimal(scaled, STELLAR_DECIMALS);
}

/**
 * Convenience helper returning both the display value and the full-precision
 * value, e.g. for rendering `title={full}` on a price element.
 */
export function formatPriceWithTooltip(value: string | number | bigint): {
  display: string;
  full: string;
} {
  return {
    display: formatPrice(value),
    full: formatPriceFull(value),
  };
}
