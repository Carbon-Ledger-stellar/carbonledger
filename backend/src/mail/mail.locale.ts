export const DEFAULT_MAIL_LOCALE = 'en';
export const SUPPORTED_MAIL_LOCALES = ['en', 'es'] as const;
export type MailLocale = (typeof SUPPORTED_MAIL_LOCALES)[number];

export function resolveMailLocale(value: unknown): MailLocale {
  if (typeof value !== 'string') return DEFAULT_MAIL_LOCALE;
  const language = value.trim().toLowerCase().split(/[-_]/, 1)[0];
  return (SUPPORTED_MAIL_LOCALES as readonly string[]).includes(language)
    ? (language as MailLocale)
    : DEFAULT_MAIL_LOCALE;
}
