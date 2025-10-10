import { API_URL } from '@/lib/config';

export function resolvePreviewUrl(previewUrl?: string | null): string {
  if (!previewUrl) return '/assets/app-default.svg';
  const trimmed = previewUrl.trim();
  if (!trimmed) return '/assets/app-default.svg';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (normalized.startsWith('/uploads/')) return `${API_URL}${normalized}`;
  if (normalized.startsWith('/preview-presets/')) return normalized;
  if (normalized.startsWith('/assets/')) return normalized;
  return `${API_URL}${normalized}`;
}
