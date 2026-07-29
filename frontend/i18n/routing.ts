export const locales = ['en', 'es', 'pt', 'zh'] as const;
export type AppLocale = (typeof locales)[number];

export const defaultLocale: AppLocale = 'en';

export const LOCALE_STORAGE_KEY = 'carbonledger-locale';

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return value != null && (locales as readonly string[]).includes(value);
}
