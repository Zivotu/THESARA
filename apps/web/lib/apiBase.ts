export function getApiBase(): string {
  const prod = process.env.NEXT_PUBLIC_API_URL || 'https://api.thesara.space';

  if (typeof window !== 'undefined') {
    const isLocalHost = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
    const local = process.env.NEXT_PUBLIC_LOCAL_API_URL;
    if (isLocalHost && local) return local;
  }

  return prod;
}

export const API_URL = getApiBase();

export const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_LOCAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'https://api.thesara.space';
