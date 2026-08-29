'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { NextIntlClientProvider } from 'next-intl';
import {
  defaultLocale,
  isAppLocale,
  LOCALE_STORAGE_KEY,
  type AppLocale,
} from '@/i18n/routing';
import { loadCommonMessages } from '@/lib/i18n/load-messages';

type LocaleContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
};

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export function useAppLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error('useAppLocale must be used within LocaleProvider');
  }
  return ctx;
}

type Props = {
  children: ReactNode;
  initialMessages: Record<string, unknown>;
};

export default function LocaleProvider({ children, initialMessages }: Props) {
  const [locale, setLocaleState] = useState<AppLocale>(defaultLocale);
  const [messages, setMessages] = useState<Record<string, unknown>>(initialMessages);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (!isAppLocale(stored) || stored === defaultLocale) {
      setReady(true);
      return;
    }
    setLocaleState(stored);
    loadCommonMessages(stored)
      .then((next) => {
        setMessages(next);
        document.documentElement.lang = stored;
      })
      .finally(() => setReady(true));
  }, []);

  const setLocale = useCallback((next: AppLocale) => {
    setLocaleState(next);
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
    document.documentElement.lang = next;
    loadCommonMessages(next).then(setMessages);
  }, []);

  const contextValue = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  if (!ready) {
    return (
      <NextIntlClientProvider locale={defaultLocale} messages={initialMessages}>
        <LocaleContext.Provider value={contextValue}>{children}</LocaleContext.Provider>
      </NextIntlClientProvider>
    );
  }

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <LocaleContext.Provider value={contextValue}>{children}</LocaleContext.Provider>
    </NextIntlClientProvider>
  );
}
