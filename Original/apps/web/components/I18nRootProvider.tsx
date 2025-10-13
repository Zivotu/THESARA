"use client";
import { I18nProvider } from '@/lib/i18n-provider';

export default function I18nRootProvider({
  locale,
  messages,
  children,
}: {
  locale: string;
  messages: Record<string, string>;
  children: React.ReactNode;
}) {
  return (
    <I18nProvider value={{ locale, messages }}>
      {children}
    </I18nProvider>
  );
}

