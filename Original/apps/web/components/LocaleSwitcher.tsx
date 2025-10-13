"use client";
import { useEffect, useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-provider';

const locales = [
  { code: 'hr', label: 'Hrvatski', icon: '/flags/hr.svg' },
  { code: 'en', label: 'English', icon: '/flags/gb.svg' },
  { code: 'de', label: 'Deutsch', icon: '/flags/de.svg' },
] as const;

export default function LocaleSwitcher() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { locale: initialLocale, messages } = useI18n();
  const [locale, setLocale] = useState(
    locales.some((l) => l.code === initialLocale) ? initialLocale : locales[0].code,
  );

  useEffect(() => {
    if (locales.some((l) => l.code === initialLocale)) {
      setLocale(initialLocale);
    }
  }, [initialLocale]);

  const current = locales.find((l) => l.code === locale) || locales[0];

  function switchTo(code: string) {
    if (code === locale) return setOpen(false);
    try {
      document.cookie = `NEXT_LOCALE=${code}; path=/; max-age=31536000`;
    } catch {}
    startTransition(() => {
      // Update <html lang> immediately for client-only reads
      try {
        document.documentElement.lang = code;
      } catch {}
      setLocale(code);
      // Trigger a server render so I18nRootProvider picks the new cookie
      router.refresh();
      setOpen(false);
    });
  }

  return (
    <div className="relative">
      <button
        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-700"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={messages['Nav.language'] || 'Language'}
      >
        <img src={current.icon} alt="" className="h-4 w-6 rounded-sm ring-1 ring-gray-300" aria-hidden />
        <span className="hidden md:inline text-sm font-medium">{current.label}</span>
        <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul className="absolute right-0 mt-2 w-40 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-50" role="listbox">
          {locales.map((l) => (
            <li key={l.code}>
              <button
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${l.code === locale ? 'bg-gray-100 text-gray-900' : 'text-gray-700'}`}
                onClick={() => switchTo(l.code)}
                role="option"
                aria-selected={l.code === locale}
              >
                <span className="inline-flex items-center gap-2">
                  <img src={l.icon} alt="" className="h-4 w-6 rounded-sm ring-1 ring-gray-200" aria-hidden />
                  <span>{l.label}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
