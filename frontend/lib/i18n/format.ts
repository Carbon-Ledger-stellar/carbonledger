"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";
import { toBcp47 } from "./locale-tag";

/** USDC amounts are priced in 7-decimal stroops, same precision as XLM. */
const STROOPS_PER_UNIT = 10_000_000n;

function stroopsToNumber(stroops: bigint | number | string): number {
  const n = BigInt(stroops);
  const whole = n / STROOPS_PER_UNIT;
  const frac = n % STROOPS_PER_UNIT;
  return Number(whole) + Number(frac) / Number(STROOPS_PER_UNIT);
}

export interface LocaleFormatters {
  /** Formats a stroops amount as a locale-aware decimal (grouping/decimal separators respect the active locale). */
  formatCurrency: (stroops: bigint | number | string) => string;
  formatNumber: (n: number) => string;
  formatDate: (date: Date | number | string) => string;
}

export function useLocaleFormatters(): LocaleFormatters {
  const locale = useLocale();
  const tag = toBcp47(locale);

  return useMemo<LocaleFormatters>(() => ({
    formatCurrency: (stroops) =>
      new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 7 }).format(
        stroopsToNumber(stroops),
      ),
    formatNumber: (n) => new Intl.NumberFormat(tag).format(n),
    formatDate: (date) => new Intl.DateTimeFormat(tag, { dateStyle: "medium" }).format(new Date(date)),
  }), [tag]);
}
