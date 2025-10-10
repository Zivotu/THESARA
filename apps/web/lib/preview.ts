import { API_URL } from '@/lib/config';

function buildUploadsUrl(path: string): string {
  if (/^https?:\/\//i.test(API_URL)) {
    try {
      const api = new URL(API_URL);
      return `${api.origin}${path}`;
    } catch {
      // ignore and fall back to concatenation below
    }
  }
  const base = API_URL.replace(/\/$/, '');
  return `${base}${path}`;
}

export function resolvePreviewUrl(previewUrl?: string | null): string {
  if (!previewUrl) return '/assets/app-default.svg';
  const trimmed = previewUrl.trim();
  if (!trimmed) return '/assets/app-default.svg';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (normalized.startsWith('/uploads/')) return buildUploadsUrl(normalized);
  if (normalized.startsWith('/preview-presets/')) return normalized;
  if (normalized.startsWith('/assets/')) return normalized;
  return `${API_URL}${normalized}`;
}
