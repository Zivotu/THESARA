import {cookies, headers} from 'next/headers';
import {locales, type Locale} from '@/i18n/config';

export function isLocale(v?: string | null): v is Locale {
  return !!v && (locales as readonly string[]).includes(v);
}

export function normalizeLocale(v?: string | null, fallback: Locale = 'hr'): Locale {
  if (!v) return fallback;
  const c = v.toLowerCase().slice(0, 2);
  return (locales as readonly string[]).includes(c) ? (c as Locale) : fallback;
}

// Server-only helper: picks locale from NEXT_LOCALE cookie, then Accept-Language, else fallback
export async function getServerLocale(fallback: Locale = 'hr'): Promise<Locale> {
  const c = await cookies();
  const hdrs = await headers();
  const fromCookie = c.get('NEXT_LOCALE')?.value || null;
  if (isLocale(fromCookie)) return fromCookie;
  const fromHdr = hdrs.get('accept-language') || '';
  const first = fromHdr.split(',')[0] || '';
  return normalizeLocale(first, fallback);
}

// For Route Handlers (re-usable with the Request object)
export function getLocaleFromRequest(req: Request, fallback: Locale = 'hr'): Locale {
  const fromCookie = parseCookie(req.headers.get('cookie') || '')['NEXT_LOCALE'] || null;
  if (isLocale(fromCookie)) return fromCookie;
  const fromHdr = req.headers.get('accept-language') || '';
  const first = fromHdr.split(',')[0] || '';
  return normalizeLocale(first, fallback);
}

function parseCookie(str: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of str.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join('='));
  }
  return out;
}

