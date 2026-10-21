/**
 * Locale-aware number formatting helpers for credit quantities.
 *
 * Uses Intl.NumberFormat so large credit amounts render with the active
 * locale's grouping separators (e.g. 1,250,000 in en, 1.250.000 in de).
 */

const DEFAULT_LOCALE = 'en';

/**
 * Resolve the active locale, falling back to the default when unavailable.
 */
export function resolveLocale(locale?: string): string {
  if (locale && locale.trim().length > 0) {
    return locale;
  }

  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language;
  }

  return DEFAULT_LOCALE;
}

/**
 * Format a credit quantity with locale-aware grouping separators.
 *
 * @param value  The numeric credit amount (or numeric string).
 * @param locale The active locale; defaults to the runtime locale.
 */
export function formatCreditAmount(
  value: number | string | null | undefined,
  locale?: string,
): string {
  const numeric = typeof value === 'string' ? Number(value) : value;

  if (numeric === null || numeric === undefined || Number.isNaN(numeric)) {
    return '';
  }

  return new Intl.NumberFormat(resolveLocale(locale)).format(numeric);
}

export default formatCreditAmount;
