import { getRequestConfig } from 'next-intl/server';
import { defaultLocale } from './routing';

export default getRequestConfig(async () => {
  const locale = defaultLocale;
  const messages = (await import(`../public/locales/${locale}/common.json`)).default;

  return {
    locale,
    messages,
  };
});
