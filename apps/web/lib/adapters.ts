import type { Listing } from './types';

// Normalize list responses coming from BE (can be items, listings, apps, results, data, data_v2.items)
export function normalizeList(res: any): {
  items: Listing[]; count: number; total: number; lang?: string; me?: any;
} {
  const items =
    res?.listings ??
    res?.items ??
    res?.apps ??
    res?.results ??
    res?.data ??
    res?.data_v2?.items ?? [];
  const arr: Listing[] = (items || []).map(toListing);
  const count = Number(res?.count ?? res?.data_v2?.count ?? arr.length);
  const total = Number(res?.total ?? res?.data_v2?.total ?? arr.length);
  const lang = res?.lang;
  const me = res?.me ?? null;
  return { items: arr, count, total, lang, me };
}

// Normalize detail (BE returns { listing } or sometimes { item } or the object itself)
export function normalizeDetail(res: any): Listing | null {
  const obj = res?.listing ?? res?.item ?? res;
  if (!obj) return null;
  return toListing(obj);
}

// Entitlements adapter (BE stub → FE shape)
export function normalizeEntitlements(res: any): { purchases: any[]; gold: boolean; noAds: boolean } {
  const items = res?.items ?? res?.apps ?? res?.entitlements ?? [];
  return { purchases: items, gold: false, noAds: false };
}

export function toListing(x: any): Listing {
  if (!x) return x;
  const rawAuthor = typeof x.author === 'object' && x.author ? x.author : undefined;
  const authorUid = rawAuthor?.uid ?? x.ownerUid ?? x.owner ?? undefined;
  const authorName = rawAuthor?.name ?? x.ownerName ?? x.owner_name ?? x.ownerDisplayName ?? x.owner ?? undefined;
  const authorHandle = rawAuthor?.handle ?? x.ownerHandle ?? x.handle ?? undefined;
  const authorPhoto = rawAuthor?.photo ?? x.authorPhoto ?? x.ownerPhoto ?? undefined;
  const author =
    authorUid || authorName || authorHandle || authorPhoto
      ? {
          uid: authorUid ? String(authorUid) : undefined,
          name: authorName ? String(authorName) : undefined,
          handle: authorHandle ? String(authorHandle).replace(/^@/, '') : undefined,
          photo: authorPhoto ? String(authorPhoto) : undefined,
        }
      : undefined;
  return {
    id: String(x.id ?? ''),
    slug: String(x.slug ?? '').toLowerCase(),
    title: String(x.title ?? x.name ?? 'Untitled'),
    name: x.name ?? x.title ?? 'Untitled',
    description: x.description ?? undefined,
    shortDescription: x.shortDescription ?? x.description ?? undefined,
    previewUrl: x.previewUrl ?? x.image ?? x.logo ?? x.thumbnail ?? undefined,
    image: x.image ?? undefined,
    logo: x.logo ?? undefined,
    thumbnail: x.thumbnail ?? undefined,
    icon: x.icon ?? undefined,
    href: x.href ?? null,
    link: x.link ?? null,
    url: x.url ?? null,
    homepage: x.homepage ?? null,
    category: x.category ?? null,
    tags: Array.isArray(x.tags) ? x.tags : (x.tags ? [String(x.tags)] : []),
    version: x.version ?? null,
    ownerUid: x.ownerUid ?? x.owner ?? null,
    published: x.published ?? true,
    visibility: x.visibility ?? 'public',
    state: x.state ?? 'ACTIVE',
    approved: x.approved ?? true,
    createdAt: x.createdAt ?? undefined,
    updatedAt: x.updatedAt ?? undefined,
    author,
  };
}
