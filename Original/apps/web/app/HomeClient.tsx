'use client';
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { API_URL, SITE_NAME } from '@/lib/config';
import { useAuth, getDisplayName } from '@/lib/auth';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import Logo from '@/components/Logo';
import { triggerConfetti } from '@/components/Confetti';
import { handleFetchError } from '@/lib/handleFetchError';
import { apiFetch, apiGet, ApiError } from '@/lib/api';
import AppCard, { type Listing } from '@/components/AppCard';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useI18n } from '@/lib/i18n-provider';
import type { Listing as ApiListing } from '@/lib/types';
import { resolvePreviewUrl } from '@/lib/preview';
import { useSafeSearchParams } from '@/hooks/useSafeSearchParams';
export {};
type HomeClientProps = {
  initialItems?: ApiListing[];
};

type LoadOptions = {
  silent?: boolean;
};

function toCardListing(item: ApiListing): Listing {
  const rawCreated = (item as any).createdAt ?? item.createdAt;
  const createdAt = typeof rawCreated === 'number'
    ? rawCreated
    : rawCreated
    ? new Date(rawCreated).getTime()
    : Date.now();

  const tags = Array.isArray(item.tags)
    ? item.tags
    : item.tags
    ? [String(item.tags)]
    : [];

  const likesCount = (item as any).likesCount;
  const playsCount = (item as any).playsCount;
  const likedByMe = (item as any).likedByMe;
  const price = (item as any).price;
  const isSubscribed = (item as any).isSubscribed;

  return {
    ...item,
    tags,
    visibility: item.visibility === 'unlisted' ? 'unlisted' : 'public',
    playUrl: (item as any).playUrl ?? '',
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    likesCount: typeof likesCount === 'number' ? likesCount : undefined,
    playsCount: typeof playsCount === 'number' ? playsCount : undefined,
    likedByMe: typeof likedByMe === 'boolean' ? likedByMe : undefined,
    price: typeof price === 'number' ? price : undefined,
    isSubscribed: typeof isSubscribed === 'boolean' ? isSubscribed : undefined,
  } as Listing;
}

function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}
function Toast({
  message,
  type = 'success',
  onClose,
}: {
  message: string;
  type?: 'success' | 'error' | 'info';
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);
  const colors = {
    success: 'from-emerald-500 to-green-600',
    error: 'from-red-500 to-red-600',
    info: 'from-blue-500 to-blue-600',
  } as const;
  return (
    <div className="fixed bottom-4 right-4 z-50 animate-slideInRight">
      <div className={cn('flex items-center gap-3 px-4 py-3 rounded-xl text-white shadow-lg bg-gradient-to-r', colors[type])}>
        <span className="font-medium">{message}</span>
      </div>
    </div>
  );
}

function DetailsModal({ open, item, onClose }: { open: boolean; item: Listing | null; onClose: () => void }) {
  const [full, setFull] = useState<Listing | null>(null);
  const { messages, locale } = useI18n();
  const tHome = (k: string, params?: Record<string, any>) => {
    let s = messages[`Home.${k}`] || '';
    if (params) for (const [pk, pv] of Object.entries(params)) s = s.replaceAll(`{${pk}}`, String(pv));
    return s || k;
  };
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!open || !item?.slug) { setFull(null); return; }
      try {
        const { getListingBySlug } = await import('@/lib/loaders');
        const detail = await getListingBySlug(item.slug, { locale });
        if (!cancelled && detail) setFull({ ...item, ...toCardListing(detail) });
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [open, item?.slug, locale]);
  if (!open || !item) return null;
  const data = (full || item) as Listing;
  const imgSrc = resolvePreviewUrl(data.previewUrl);
  const hasPreview = Boolean(imgSrc);
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden animate-slideUp">
        <div className="relative h-56 bg-gray-50">
          {hasPreview ? (
            <Image src={imgSrc} alt={data.title} fill style={{ color: 'transparent' }} className="object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm font-medium">
              Bez grafike
            </div>
          )}
          <button onClick={onClose} className="absolute top-3 right-3 p-2 rounded-full bg-white/90 hover:bg-white shadow" aria-label="Close">
            <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900 line-clamp-1">{data.title}</h2>
            <span className="text-sm text-gray-500">{tHome('plays', { count: data.playsCount ?? 0 })}</span>
          </div>
          {typeof data.price === 'number' && data.price > 0 && (
            <div className="mt-2 inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium">
              Price: €{Number(data.price).toFixed(2)}
            </div>
          )}
          {data.description && (
            <p className="mt-2 text-gray-600 whitespace-pre-line">{data.description}</p>
          )}
          {!!data.tags?.length && (
            <div className="mt-3 flex flex-wrap gap-1">
              {data.tags.map((t) => (
                <span key={t} className="text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">#{t}</span>
              ))}
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href={{ pathname: '/play', query: { appId: data.id, run: '1' } }}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700"
            >
              Play
            </Link>
            <Link href={{ pathname: '/app', query: { slug: data.slug } }} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50" onClick={onClose}>Full Details</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomeClient({ initialItems = [] }: HomeClientProps) {
  const ent = useEntitlements();
  const initialItemsRef = useRef(initialItems?.map(toCardListing) ?? []);
  const [subscribed, setSubscribed] = useState<Set<string>>(new Set());
  const router = useRouter();
  const searchParams = useSafeSearchParams();
  const { messages, locale } = useI18n();
  const tHome = (k: string, params?: Record<string, any>) => {
    let s = messages[`Home.${k}`] || '';
    if (params) for (const [pk, pv] of Object.entries(params)) s = s.replaceAll(`{${pk}}`, String(pv));
    return s || k;
  };
  const tToast = useCallback((k: string) => messages[`Toasts.${k}`] || k, [messages]);
  const tNav = (k: string) => messages[`Nav.${k}`] || k;
  const [items, setItems] = useState<Listing[]>(initialItemsRef.current);
  const [q, setQ] = useState('');
  const [isLoading, setIsLoading] = useState(initialItemsRef.current.length === 0);
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [detailsItem, setDetailsItem] = useState<Listing | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      let adminClaim = false;
      if (user) {
        try {
          const tok = await auth?.currentUser?.getIdTokenResult(true);
          adminClaim = !!tok?.claims?.admin || tok?.claims?.role === 'admin' || !!tok?.claims?.isAdmin;
        } catch {
          adminClaim = false;
        }
      }
      if (!cancelled) setIsAdmin(adminClaim);
    };
    check();
    return () => { cancelled = true; };
  }, [user]);
  const name = getDisplayName(user);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'new' | 'popular' | 'title'>('new');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [errorMessage, setErrorMessage] = useState('');
  const [errorDetails, setErrorDetails] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const openDetails = useCallback((it: Listing) => setDetailsItem(it), []);
  const closeDetails = useCallback(() => setDetailsItem(null), []);
  const welcome = searchParams.get('welcome');

  // Load subscribed app ids to highlight cards
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.uid) {
        setSubscribed(new Set());
        return;
      }
      try {
        const json = await apiGet('/me/subscribed-apps', { auth: true });
        const { normalizeList } = await import('@/lib/adapters');
        const { items: subscribedItems } = normalizeList(json);
        if (cancelled) return;
        const ids = new Set(subscribedItems.map((it) => it.id));
        setSubscribed(ids);
      } catch {
        // fallback: try to interpret entitlements purchases as ids if they look like uuids
        const maybeIds = (ent.data?.purchases || []).filter((p) => typeof p === 'string' && p.length > 10) as string[];
        setSubscribed(new Set(maybeIds));
      }
    })();
    return () => { cancelled = true; };
  }, [ent.data?.purchases?.length, user?.uid]);

  useEffect(() => {
    if (welcome) {
      setToast({ message: tToast('welcome'), type: 'success' });
      router.replace('/');
    }
  }, [welcome, router, tToast]);
  const handlePublishClick = useCallback(() => {
    triggerConfetti();
    router.push('/create');
  }, [router]);

  // Transform-based carousel
  const trackRef = useRef<HTMLDivElement | null>(null);
  const firstSlideRef = useRef<HTMLDivElement | null>(null);
  const [slideSize, setSlideSize] = useState(296);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [disableTransition, setDisableTransition] = useState(false);

  const toggleLike = useCallback(
    async (slug: string) => {
      if (busy[slug]) return;
      if (!user?.uid) {
        setToast({ message: tToast('loginToLike'), type: 'info' });
        return;
      }
      setBusy((prev) => ({ ...prev, [slug]: true }));
      try {
        const current = items.find((it) => it.slug === slug);
        const like = !(current?.likedByMe);
        try {
          await apiFetch(`/listing/${slug}/like`, { method: 'POST', body: { uid: user?.uid, like }, auth: true });
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) {
            if (auth) await signOut(auth);
            window.location.href = '/login';
            return;
          }
          if (e instanceof ApiError && e.status === 429) {
            setToast({ message: tToast('slowDown'), type: 'info' });
            return;
          }
          throw e;
        }
        setItems((prev) => prev.map((it) => it.slug === slug ? { ...it, likedByMe: like, likesCount: Math.max(0, (it.likesCount || 0) + (like ? 1 : -1)) } : it));
        const el = document.getElementById(`like-${slug}`);
        if (el) {
          el.classList.add('animate-bounce');
          setTimeout(() => el.classList.remove('animate-bounce'), 500);
        }
        if (like) triggerConfetti();
      } catch (e) {
        handleFetchError(e, 'Failed to toggle like');
        setToast({ message: tToast('likeError'), type: 'error' });
      } finally {
        setBusy((prev) => ({ ...prev, [slug]: false }));
      }
    },
    [busy, items, user, tToast]
  );

  const load = useCallback((options: LoadOptions = {}) => {
    let retryCount = 0;
    const maxRetries = 3;
    const fetchData = async () => {
      const { silent } = options;
      if (!silent) {
        setIsLoading(true);
      }
      setErrorMessage('');
      setErrorDetails('');
      try {
        const { getListings } = await import('@/lib/loaders');
        const { items: normalized } = await getListings({ locale });
        setItems(normalized.map(toCardListing));
      } catch (e) {
        handleFetchError(e, 'Failed to load listings');
        if (!silent) {
          setErrorDetails(e instanceof Error ? e.message : String(e));
        }
        if (retryCount < maxRetries) {
          retryCount++;
          setTimeout(fetchData, 1000 * retryCount);
          return;
        }
        if (silent) {
          setToast({ message: tToast('loadError'), type: 'error' });
        } else {
          setErrorMessage(tToast('loadError'));
          setItems([]);
        }
      } finally {
        if (!silent) {
          setIsLoading(false);
        }
      }
    };
    fetchData();
  }, [tToast, locale]);

  const lastLocaleRef = useRef<string | null>(null);
  const fetched = useRef(false);
  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    lastLocaleRef.current = locale;
    if (initialItemsRef.current.length) {
      load({ silent: true });
      return;
    }
    load();
  }, [load, locale]);

  // Re-fetch listings when locale changes so cards update immediately
  useEffect(() => {
    if (!fetched.current) return;
    if (lastLocaleRef.current === locale) return;
    lastLocaleRef.current = locale;
    load();
  }, [locale, load]);

  const tagData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of items) (it.tags || []).forEach(t => counts.set(t, (counts.get(t) || 0) + 1));
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [items]);

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  }, []);
  const clearFilters = useCallback(() => { setSelectedTags([]); setQ(''); setSortBy('new'); }, []);

  const processed = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let result = items.filter(x => x.visibility !== 'unlisted');
    if (needle) {
      result = result
        .filter(x => {
          const score = (x.title.toLowerCase().includes(needle) ? 3 : 0) + ((x.description || '').toLowerCase().includes(needle) ? 2 : 0) + ((x.tags || []).some(t => t.toLowerCase().includes(needle)) ? 1 : 0);
          return score > 0;
        })
        .sort((a, b) => {
          const scoreA = (a.title.toLowerCase().includes(needle) ? 3 : 0) + ((a.description || '').toLowerCase().includes(needle) ? 2 : 0) + ((a.tags || []).some(t => t.toLowerCase().includes(needle)) ? 1 : 0);
          const scoreB = (b.title.toLowerCase().includes(needle) ? 3 : 0) + ((b.description || '').toLowerCase().includes(needle) ? 2 : 0) + ((b.tags || []).some(t => t.toLowerCase().includes(needle)) ? 1 : 0);
          return scoreB - scoreA;
        });
    }
    if (selectedTags.length) {
      result = result.filter(x => { const tags = x.tags || []; return selectedTags.every(t => tags.includes(t)); });
    }
    if (!needle) {
      result = [...result].sort((a, b) => {
        if (sortBy === 'new') {
          const tb = typeof b.createdAt === 'number' ? b.createdAt : new Date(b.createdAt ?? 0).getTime();
          const ta = typeof a.createdAt === 'number' ? a.createdAt : new Date(a.createdAt ?? 0).getTime();
          return (tb || 0) - (ta || 0);
        }
        if (sortBy === 'popular') return (b.likesCount || 0) - (a.likesCount || 0);
        return a.title.localeCompare(b.title);
      });
    }
    return result;
  }, [items, q, selectedTags, sortBy]);

  const topLiked = useMemo(() => {
    const src = processed.length ? processed : items;
    const sorted = [...src].sort((a, b) => (b.likesCount || 0) - (a.likesCount || 0));
    const withPreview = sorted.filter((x) => !!x.previewUrl);
    const withoutPreview = sorted.filter((x) => !x.previewUrl);
    return [...withPreview, ...withoutPreview].slice(0, 10);
  }, [processed, items]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && e.ctrlKey) { e.preventDefault(); document.getElementById('search-input')?.focus(); }
      if (e.key === 'Escape') setShowFilters(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const measure = () => {
      const el = firstSlideRef.current; if (!el) return; const rect = el.getBoundingClientRect(); setSlideSize(Math.round(rect.width + 16));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [topLiked.length]);

  useEffect(() => {
    if (topLiked.length <= 1 || paused) return;
    const t = setInterval(() => { setCarouselIndex((i) => i + 1); }, 2800);
    return () => clearInterval(t);
  }, [topLiked.length, paused]);

  useEffect(() => {
    if (topLiked.length === 0) return;
    if (carouselIndex >= topLiked.length) {
      const id = setTimeout(() => { setDisableTransition(true); setCarouselIndex(0); requestAnimationFrame(() => setDisableTransition(false)); }, 400);
      return () => clearTimeout(id);
    }
  }, [carouselIndex, topLiked.length]);
  const prevCarousel = useCallback(() => { setDisableTransition(false); setCarouselIndex((prev) => (prev > 0 ? prev - 1 : topLiked.length > 0 ? topLiked.length - 1 : 0)); }, [topLiked.length]);
  const nextCarousel = useCallback(() => { setDisableTransition(false); setCarouselIndex((prev) => prev + 1); }, []);

  return (
    <div className="min-h-screen text-gray-900 bg-white">
      <section className="max-w-7xl mx-auto px-4 pt-12 pb-6">
        <div className="flex flex-col items-center text-center">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900">
            {tHome('headline.one')} <span className="text-emerald-600">{tHome('headline.two')}</span>
          </h1>
          <p className="mt-3 text-lg text-gray-500 max-w-2xl">{tHome('tagline')}</p>
        </div>
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700">{tHome('trending')}</span>
            <div className="text-xs text-gray-500">{tHome('appsCount', { count: topLiked.length })}</div>
          </div>
          <div className="relative">
            <div className="overflow-hidden pb-2">
              <div
                ref={trackRef}
                className={cn('flex gap-4', disableTransition ? '' : 'transition-transform duration-500 ease-out')}
                onMouseEnter={() => setPaused(true)}
                onMouseLeave={() => setPaused(false)}
                style={{ transform: `translateX(-${carouselIndex * slideSize}px)` }}
              >
                {[...topLiked, ...topLiked].map((it, idx) => {
                  const img = resolvePreviewUrl(it.previewUrl);
                  const hasPreview = Boolean(img);
                  const imgProps = idx === 0 ? { priority: true, loading: 'eager' as const } : {};
                  return (
                    <div key={`${it.id}-${idx}`} data-carousel-item ref={idx === 0 ? firstSlideRef : undefined} className="w-[280px] flex-none">
                      <div onClick={() => router.push(`/app?slug=${encodeURIComponent(it.slug)}`)} className="group cursor-pointer rounded-2xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition overflow-hidden">
                        <div className="relative h-40">
                          {hasPreview ? (
                            <Image src={img} alt={it.title} fill style={{ color: 'transparent' }} className="object-cover transition-transform duration-300 group-hover:scale-105" {...imgProps} />
                          ) : (
                            <div className="w-full h-full bg-slate-100 text-slate-500 text-xs font-medium grid place-items-center">
                              Bez grafike
                            </div>
                          )}
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3">
                            <span className="text-white text-base font-medium line-clamp-1">{it.title}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <button onClick={prevCarousel} className="absolute left-0 top-1/2 -translate-y-1/2 bg-white/80 p-2 rounded-full shadow-md" aria-label="Previous">
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <button onClick={nextCarousel} className="absolute right-0 top-1/2 -translate-y-1/2 bg-white/80 p-2 rounded-full shadow-md" aria-label="Next">
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        </div>
        <div className="mt-8 w-full max-w-2xl mx-auto">
          <div className="relative">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input id="search-input" value={q} onChange={e => setQ(e.target.value)} placeholder={tHome('search.placeholder')} className="w-full pl-10 pr-4 py-3 rounded-full border border-gray-200 focus:border-emerald-500 focus:outline-none transition text-base placeholder-gray-400" autoComplete="off" />
            {q && (
              <button onClick={() => setQ('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" aria-label="Clear search">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            )}
          </div>
        </div>
      </section>
      <section className="max-w-7xl mx-auto px-4 pb-6">
        <div className="bg-white rounded-2xl border border-gray-200 p-3 mb-6 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <span>{tHome('appsFound', { count: processed.length })}</span>
            <div className="flex bg-gray-100 rounded-md p-1">
              <button onClick={() => setViewMode('grid')} className={cn('p-1.5 rounded transition flex items-center', viewMode === 'grid' ? 'bg-white shadow-sm' : 'hover:bg-gray-200')} aria-label="Grid view">
                <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
              </button>
              <button onClick={() => setViewMode('list')} className={cn('p-1.5 rounded transition flex items-center', viewMode === 'list' ? 'bg-white shadow-sm' : 'hover:bg-gray-200')} aria-label="List view">
                <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex flex-wrap gap-2">
              {tagData.slice(0, 6).map(([tag]) => (
                <button key={tag} onClick={() => toggleTag(tag)} className={cn('px-3 py-1 rounded-full text-sm border transition', selectedTags.includes(tag) ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50')} aria-pressed={selectedTags.includes(tag)}>
                  #{tag}
                </button>
              ))}
              {tagData.length > 6 && (<button className="px-3 py-1 text-sm text-gray-500 hover:text-gray-700">+{tagData.length - 6}</button>)}
            </div>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as 'new' | 'popular' | 'title')} className="rounded-md border border-gray-200 bg-white px-3 py-1 text-sm text-gray-600 focus:outline-none focus:border-emerald-500">
              <option value="new">{tHome('sort.new')}</option>
              <option value="popular">{tHome('sort.popular')}</option>
              <option value="title">{tHome('sort.title')}</option>
            </select>
            {(selectedTags.length > 0 || q) && (
              <button onClick={clearFilters} className="text-sm text-red-500 hover:underline">{tHome('clear')}</button>
            )}
          </div>
        </div>
        {errorMessage && (<div className="mb-6 p-4 rounded-lg bg-red-50 text-red-700 text-sm">{errorMessage}</div>)}
      </section>
      <main className="max-w-7xl mx-auto px-4 pb-16">
        {isLoading ? (
          <div className={cn(viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6' : 'space-y-4')}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-2xl overflow-hidden animate-pulse">
                <div className="aspect-video bg-gray-100" />
                <div className="p-4">
                  <div className="h-6 bg-gray-100 rounded w-3/4 mb-2" />
                  <div className="h-4 bg-gray-100 rounded w-full mb-4" />
                  <div className="flex gap-2"><div className="h-4 bg-gray-100 rounded w-16" /><div className="h-4 bg-gray-100 rounded w-16" /></div>
                </div>
              </div>
            ))}
          </div>
        ) : processed.length ? (
          <div className={cn(viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6' : 'space-y-4')}>
            {processed.map((item, i) => (
              <AppCard
                key={item.id}
                item={{ ...item, isSubscribed: subscribed.has(item.id) }}
                toggleLike={toggleLike}
                busy={busy}
                viewMode={viewMode}
                onDetails={openDetails}
                priority={i === 0}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <h3 className="text-2xl font-bold text-gray-900">{tHome('noApps')}</h3>
            <p className="mt-2 text-gray-500">{q || selectedTags.length ? tHome('tryAdjust') : tHome('beFirst')}</p>
            <div className="mt-6">
              <Link href="/create" onClick={handlePublishClick} className="px-5 py-2.5 rounded-lg bg-emerald-500 text-white font-medium transition hover:bg-emerald-600" title="Publish your first app">{tHome('publish')}</Link>
            </div>
          </div>
        )}
        {errorDetails && (
          <div className="mt-6 text-center">
            <p className="text-sm text-red-700">{errorDetails}</p>
            <button onClick={() => load()} className="mt-2 px-4 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600">{tToast('retry')}</button>
          </div>
        )}
      </main>
      <footer className="border-t bg-white">
        <div className="max-w-7xl mx-auto px-4 py-12 text-sm text-gray-500">
          <div className="flex flex-col md:flex-row justify-between gap-8">
            <div>
              <Logo className="mb-4" />
            </div>
            <div className="flex gap-12">
              <div>
                <h4 className="font-medium mb-3 text-gray-900">Platform</h4>
                <ul className="space-y-2">
                  <li><Link href="/marketplace" className="hover:text-emerald-600 transition">Browse Apps</Link></li>
                  <li><Link href="/create" className="hover:text-emerald-600 transition">Publish App</Link></li>
                  <li><Link href="/my" className="hover:text-emerald-600 transition">My Projects</Link></li>
                </ul>
              </div>
              <div>
                <h4 className="font-medium mb-3 text-gray-900">Resources</h4>
                <ul className="space-y-2">
                  <li><Link href="/faq" className="hover:text-emerald-600 transition">FAQ</Link></li>
                  <li><Link href="/docs" className="hover:text-emerald-600 transition">Documentation</Link></li>
                  <li><Link href="/tutorials" className="hover:text-emerald-600 transition">Tutorials</Link></li>
                  <li><Link href="/api" className="hover:text-emerald-600 transition">API Reference</Link></li>
                  {process.env.NODE_ENV !== 'production' && (
                    <li><Link href="/doctor" className="hover:text-emerald-600 transition">Doctor</Link></li>
                  )}
                </ul>
              </div>
              <div>
                <h4 className="font-medium mb-3 text-gray-900">Company</h4>
                <ul className="space-y-2">
                  <li><Link href="/about" className="hover:text-emerald-600 transition">About Us</Link></li>
                  <li><Link href="/terms" className="hover:text-emerald-600 transition">Terms</Link></li>
                  <li><Link href="/privacy" className="hover:text-emerald-600 transition">Privacy</Link></li>
                </ul>
              </div>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t text-center">Â© {new Date().getFullYear()} {SITE_NAME}.</div>
        </div>
      </footer>
      {toast && (<Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />)}
      <DetailsModal open={!!detailsItem} item={detailsItem} onClose={closeDetails} />
    </div>
  );
}




















