const DEFAULT_PROD_API = 'https://api.thesara.space/api';

export function normalizeApiUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('/')) {
    const normalized = trimmed.replace(/^\/+|\/+$/g, '');
    return normalized ? `/${normalized}` : '/';
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const rawPath = url.pathname?.replace(/\/+$/, '') ?? '';
      if (!rawPath) {
        if (url.hostname === 'api.thesara.space') {
          url.pathname = '/api';
        } else {
          url.pathname = '/';
        }
      } else {
        url.pathname = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
      }
      const out = url.toString();
      return url.pathname === '/' ? out.replace(/\/+$/, '') : out;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

const PROD_API_ENV =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL;

const PROD_API_BASE = normalizeApiUrl(PROD_API_ENV) ?? DEFAULT_PROD_API;

function resolveLocalApiOverride(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const isLocalHost = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
  if (!isLocalHost) return undefined;
  const normalized = normalizeApiUrl(process.env.NEXT_PUBLIC_LOCAL_API_URL);
  return normalized ?? process.env.NEXT_PUBLIC_LOCAL_API_URL ?? undefined;
}

export function getApiBase(): string {
  const local = resolveLocalApiOverride();
  return local ?? PROD_API_BASE;
}

export const API_URL = getApiBase();

export const INTERNAL_API_URL =
  normalizeApiUrl(process.env.INTERNAL_API_URL) ??
  normalizeApiUrl(process.env.NEXT_PUBLIC_LOCAL_API_URL) ??
  PROD_API_BASE;
