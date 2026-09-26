import type { AppLocale } from "@/i18n/routing";

/** Maps the app's short locale codes to full BCP-47 tags for Intl.* formatting. */
const BCP47_TAGS: Record<AppLocale, string> = {
  en: "en-US",
  es: "es-ES",
  pt: "pt-BR",
  zh: "zh-CN",
};

export function toBcp47(locale: string): string {
  return BCP47_TAGS[locale as AppLocale] ?? "en-US";
}
