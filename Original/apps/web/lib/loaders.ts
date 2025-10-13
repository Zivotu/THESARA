import { apiGet } from '@/lib/api';
import { normalizeDetail, normalizeList } from '@/lib/adapters';
import type { Listing } from '@/lib/types';

type ListOptions = { locale?: string };

type ListResult = ReturnType<typeof normalizeList>;

function withLocale(url: string, locale?: string) {
  if (!locale) return url;
  const query = `lang=${encodeURIComponent(locale)}`;
  return url.includes('?') ? `${url}&${query}` : `${url}?${query}`;
}

export async function getListingBySlug(
  slug: string,
  opts: { locale?: string } = {},
): Promise<Listing | null> {
  const encodedSlug = encodeURIComponent(slug);
  const candidates = [
    `/apps?slug=${encodedSlug}`,
    `/listing?slug=${encodedSlug}`,
    `/apps/${encodedSlug}`,
  ];
  for (const baseUrl of candidates) {
    try {
      const res = await apiGet(withLocale(baseUrl, opts.locale));
      const item = normalizeDetail(res);
      if (item) return item;
    } catch {}
  }
  return null;
}

export async function getListings(opts: ListOptions = {}): Promise<ListResult> {
  const res = await apiGet(withLocale('/listings', opts.locale));
  return normalizeList(res);
}

export type ListingsResult = ListResult;
