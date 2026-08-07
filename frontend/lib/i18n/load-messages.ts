import type { AppLocale } from '@/i18n/routing';

export async function loadCommonMessages(locale: AppLocale): Promise<Record<string, unknown>> {
  const mod = await import(`../../public/locales/${locale}/common.json`);
  return mod.default as Record<string, unknown>;
}
