import type { ReactNode } from 'react';
import './__name-shim';
import './globals.css';
import Header from '@/components/Header';
import ChunkErrorBoundary from '@/components/ChunkErrorBoundary';
import { AuthProvider } from '@/lib/auth';
import I18nRootProvider from '@/components/I18nRootProvider';
import { messages as ALL_MESSAGES, type Locale, defaultLocale } from '@/i18n/config';
import { getServerLocale } from '@/lib/locale';

export const metadata = {
  title: 'CreateX',
  description: 'Discover, play and publish mini-apps.',
};

if (typeof window !== 'undefined') {
  void import('@/lib/apiBase').then(({ API_URL }) => {
    // eslint-disable-next-line no-console
    console.info(`[theSara/web] API base: ${API_URL}`);
  });
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale: Locale = await getServerLocale(defaultLocale);
  const messages = ALL_MESSAGES[locale] || ALL_MESSAGES[defaultLocale];

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-screen bg-white text-gray-900">
        <ChunkErrorBoundary>
          <AuthProvider>
            <I18nRootProvider locale={locale} messages={messages}>
              <Header />
              {children}
            </I18nRootProvider>
          </AuthProvider>
        </ChunkErrorBoundary>
      </body>
    </html>
  );
}

