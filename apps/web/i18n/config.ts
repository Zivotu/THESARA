export const locales = ['en', 'hr', 'de'] as const;
export type Locale = typeof locales[number];

export const defaultLocale: Locale = 'hr';

export function isLocale(v?: string | null): v is Locale {
  return !!v && (locales as readonly string[]).includes(v);
}

import enRaw from '../messages/en.json';
import hrRaw from '../messages/hr.json';
import deRaw from '../messages/de.json';

function flatten(obj: any, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v as any, key));
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

export const messages: Record<Locale, Record<string, string>> = {
  en: flatten(enRaw),
  hr: flatten(hrRaw),
  de: flatten(deRaw),
};
