import { API_URL } from '@/lib/config';

export function resolvePreviewUrl(previewUrl?: string | null): string {
  if (!previewUrl) return '/assets/app-default.svg';
  const trimmed = previewUrl.trim();
  if (!trimmed) return '/assets/app-default.svg';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/uploads/')) return `${API_URL}${trimmed}`;
  if (trimmed.startsWith('/preview-presets/')) return trimmed;
  if (trimmed.startsWith('/assets/')) return trimmed;
  return `${API_URL}${trimmed}`;
}
