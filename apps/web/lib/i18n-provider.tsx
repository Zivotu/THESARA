"use client";
import { createContext, useContext, useMemo } from "react";

type Messages = Record<string, string>;

const I18nContext = createContext<{ locale: string; messages: Messages }>({
  locale: "en",
  messages: {},
});

export const I18nProvider = I18nContext.Provider;
export const useI18n = () => useContext(I18nContext);

function interpolate(input: string, params?: Record<string, string | number>): string {
  if (!params) return input;
  let out = input;
  for (const [k, v] of Object.entries(params)) {
    out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

// useT: optional namespace helper for consistent lookups and formatting
export function useT(ns?: string) {
  const { locale, messages } = useI18n();
  return useMemo(() => {
    const t = (key: string, params?: Record<string, string | number>) => {
      const fullKey = ns ? `${ns}.${key}` : key;
      const raw = messages[fullKey] ?? key;
      return interpolate(raw, params);
    };
    const formatNumber = (n: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(locale, options).format(n);
    return Object.assign(t, { formatNumber });
  }, [locale, messages, ns]);
}

