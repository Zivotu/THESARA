'use client';
export const dynamic = 'force-dynamic';
export {};
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { API_URL } from '@/lib/config';
import { useAuth, getDisplayName } from '@/lib/auth';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { translateReason } from '@/lib/reviewReasons';
import { useI18n } from '@/lib/i18n-provider';
import { getPlayUrl } from '@/lib/play';
import { useRelativeTime } from '@/hooks/useRelativeTime';
import { resolvePreviewUrl } from '@/lib/preview';
import { useSafeSearchParams } from '@/hooks/useSafeSearchParams';
import {
  useConnectStatus,
  startStripeOnboarding,
} from '@/hooks/useConnectStatus';

// ————————————————————————————————————————
// Types
// ————————————————————————————————————————
type Listing = {
  id: string;
  slug: string;
  title: string;
  description?: string;
  tags?: string[];
  visibility: 'public' | 'unlisted';
  playUrl: string;
  createdAt?: number;
  author?: { uid?: string; name?: string; photo?: string };
  likesCount?: number;
  previewUrl?: string | null;
  playCount?: number;
  likedByMe?: boolean;
  state?: 'active' | 'inactive';
  status?: 'draft' | 'published' | 'pending-review' | 'rejected';
  moderation?: { reasons?: string[]; status?: string };
};

// ————————————————————————————————————————
// Helpers
// ————————————————————————————————————————
function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function timeSince(ts?: number) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.floor(mo / 12);
  return `${y}y ago`;
}

function RelativeTime({ ts }: { ts?: number }) {
  const value = useRelativeTime(ts ?? null, timeSince);
  return <>{value || ''}</>;
}

async function buildHeaders(withJson: boolean): Promise<Record<string, string>> {
  const headers: Record<string, string> = withJson ? { 'Content-Type': 'application/json' } : {};
  try {
    // @ts-ignore
    const token = await auth?.currentUser?.getIdToken?.();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  } catch { /* ignore */ }
  return headers;
}

// ————————————————————————————————————————
// Toast
// ————————————————————————————————————————
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
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-slideInRight">
      <div className={cn('flex items-center gap-3 px-4 py-3 rounded-xl text-white shadow-lg bg-gradient-to-r', colors[type])}>
        <span className="font-medium">{message}</span>
      </div>
    </div>
  );
}

// ————————————————————————————————————————
// Page
// ————————————————————————————————————————
export default function MyProjectsPage() {
  const { user } = useAuth();
  const name = getDisplayName(user);
  const searchParams = useSafeSearchParams();
  const router = useRouter();
  const { locale } = useI18n();
  const lastLocaleRef = useRef<string | null>(null);

  const [items, setItems] = useState<Listing[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [allAccessPrice, setAllAccessPrice] = useState<string>('');
  const [savingPrice, setSavingPrice] = useState(false);
  const [repoPriceUpdatedAt, setRepoPriceUpdatedAt] = useState<number | null>(null);
  const [editingRepoPrice, setEditingRepoPrice] = useState(false);
  const connect = useConnectStatus();
  const canMonetize =
    connect?.payouts_enabled && (connect.requirements_due ?? 0) === 0;

  // UI state: search / filter / sort
  const [query, setQuery] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'public' | 'unlisted'>('all');
  const [sort, setSort] = useState<'newest' | 'likes' | 'title'>('newest');

  const toggleLike = useCallback(
    async (slug: string) => {
      if (busy[slug]) return;
      setBusy((prev) => ({ ...prev, [slug]: true }));
      try {
        const current = items.find((it) => it.slug === slug);
        const like = !(current?.likedByMe);
        const res = await fetch(`${API_URL}/listing/${slug}/like`, {
          method: 'POST',
          credentials: 'include',
          headers: await buildHeaders(true),
          body: JSON.stringify({ uid: user?.uid, like }),
        });

        if (res.status === 401) {
          if (auth) await signOut(auth);
          window.location.href = '/login';
          return;
        }
        if (res.status === 429) {
          setToast({ message: 'Polako 🙂', type: 'info' });
          return;
        }
        if (!res.ok) throw new Error(`POST ${res.status}`);
        await res.json();
        setItems((prev) =>
          prev.map((it) =>
            it.slug === slug
              ? {
                  ...it,
                  likedByMe: like,
                  likesCount: Math.max(0, (it.likesCount || 0) + (like ? 1 : -1)),
                }
              : it
          )
        );

        const el = document.getElementById(`like-${slug}`);
        if (el) {
          el.classList.add('animate-bounce');
          setTimeout(() => el.classList.remove('animate-bounce'), 500);
        }
      } catch (e) {
        console.error('Failed to toggle like', e);
      } finally {
        setBusy((prev) => ({ ...prev, [slug]: false }));
      }
    },
    [busy, items, user]
  );

  const deleteItem = useCallback(
    async (item: Listing) => {
      if (busy[item.slug]) return;
      if (!window.confirm(`Delete "${item.title}"?`)) return;
      setBusy((prev) => ({ ...prev, [item.slug]: true }));
      try {
        const res = await fetch(`${API_URL}/listing/${item.slug}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: await buildHeaders(false),
        });
        if (!res.ok) throw new Error(`DELETE ${res.status}`);
        setItems((prev) => prev.filter((it) => it.slug !== item.slug));
        setToast({ message: 'App deleted', type: 'success' });
      } catch (e) {
        console.error('Failed to delete app', e);
        setToast({ message: 'Failed to delete app', type: 'error' });
      } finally {
        setBusy((prev) => ({ ...prev, [item.slug]: false }));
      }
    },
      [busy]
    );

  const handlePlayClick = useCallback(
    async (e: React.MouseEvent, item: Listing & { status?: string }) => {
      e.preventDefault();
      e.stopPropagation();
      if (item.status !== 'published') {
        setToast({ message: 'App must be approved before it can run.', type: 'info' });
        return;
      }
      const dest = await getPlayUrl(item.id);
      window.open(dest, '_blank', 'noopener,noreferrer');
    },
    [setToast]
  );

  // — Load my listings (localized)
  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      if (user?.uid) {
        try {
          const res = await fetch(
            `${API_URL}/listings?owner=${encodeURIComponent(user.uid)}&lang=${encodeURIComponent(locale)}`,
            { cache: 'no-store', credentials: 'include', headers: await buildHeaders(false) }
          );
          if (!res.ok) throw new Error(`GET ${res.status}`);
          const json = await res.json();
          setItems(json.items ?? []);
        } catch (e) {
          console.error('Failed to load my listings', e);
          setItems([]);
        } finally {
          setIsLoading(false);
        }
      } else {
        setItems([]);
        setIsLoading(false);
      }
    };
    load();
  }, [user, locale]);

  // Load my handle and repo-level price
  useEffect(() => {
    (async () => {
      if (!user?.uid) return;
      try {
        const res = await fetch(`${API_URL}/creators/id/${encodeURIComponent(user.uid)}`);
        if (!res.ok) return;
        const json = await res.json();
        const h = json?.handle as string | undefined;
        if (h) {
          setHandle(h);
          try {
            const r2 = await fetch(`${API_URL}/creators/${encodeURIComponent(h)}`);
            if (r2.ok) {
              const j2 = await r2.json();
              const p = typeof j2?.allAccessPrice === 'number' ? String(j2.allAccessPrice) : '';
              setAllAccessPrice(p);
              const upd = typeof j2?.allAccessPriceUpdatedAt === 'number' ? j2.allAccessPriceUpdatedAt : null;
              setRepoPriceUpdatedAt(upd);
            }
          } catch {}
        } else {
          setHandle(null);
        }
      } catch {}
    })();
  }, [user?.uid]);

  async function saveRepoPrice(e: React.FormEvent) {
    e.preventDefault();
    if (!handle) return;
    setSavingPrice(true);
    try {
      const headers: any = await buildHeaders(true);
      const body: any = {};
      body.allAccessPrice = allAccessPrice.trim() === '' ? 0 : Number(allAccessPrice);
      const res = await fetch(`${API_URL}/creators/${encodeURIComponent(handle)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('bad_response');
      const json = await res.json().catch(() => null);
      const creator = json?.creator ?? null;
      if (creator) {
        if (typeof creator.allAccessPrice === 'number') setAllAccessPrice(String(creator.allAccessPrice));
        if (typeof creator.allAccessPriceUpdatedAt === 'number') setRepoPriceUpdatedAt(creator.allAccessPriceUpdatedAt);
      }
      setEditingRepoPrice(false);
      setToast({ message: 'Cijena repozitorija spremljena', type: 'success' });
    } catch {
      setToast({ message: 'Spremanje nije uspjelo', type: 'error' });
    } finally {
      setSavingPrice(false);
    }
  }

  const deleted = searchParams.get('deleted') === '1';
  const submitted = searchParams.get('submitted') === '1';

  useEffect(() => {
    if (submitted) {
      setToast({ message: 'Tvoja aplikacija čeka odobrenje.', type: 'info' });
    }
  }, [submitted]);

  // Refetch handled via dependency on `locale` above

  // — Derived list (search/filter/sort)
  const filtered = useMemo(() => {
    let list = items.slice();

    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(it =>
        it.title.toLowerCase().includes(q) ||
        (it.description?.toLowerCase().includes(q)) ||
        (it.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    if (visibilityFilter !== 'all') {
      list = list.filter(it => it.visibility === visibilityFilter);
    }
    list.sort((a, b) => {
      switch (sort) {
        case 'likes': {
          const la = a.likesCount ?? 0;
          const lb = b.likesCount ?? 0;
          return lb - la;
        }
        case 'title':
          return a.title.localeCompare(b.title);
        case 'newest':
        default:
          return (b.createdAt ?? 0) - (a.createdAt ?? 0);
      }
    });
    return list;
  }, [items, query, visibilityFilter, sort]);

  const imgSrc = (it: Listing) => {
    return resolvePreviewUrl(it.previewUrl);
  };

  const copyLink = (it: Listing) => {
    const url = new URL('/play', window.location.origin);
    url.searchParams.set('appId', it.id);
    const href = url.toString();
    navigator.clipboard.writeText(href).then(() => {
      setToast({ message: 'Link copied to clipboard!', type: 'success' });
    });
  };

  if (!user) {
    return (
      <div className="min-h-screen grid place-items-center bg-gradient-to-br from-white via-emerald-50/30 to-white text-gray-900">
        <div className="bg-white border rounded-2xl shadow-md p-8 text-center max-w-md">
          <h1 className="text-2xl font-bold mb-2">My Projects</h1>
          <p className="text-gray-700 mb-6">Sign in to manage and view your created projects.</p>
          <Link href="/login" className="px-6 py-3 rounded-full bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition" title="Go to login">Go to Login</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-emerald-50/30 to-white text-gray-900">
      {/* Decorative blobs */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-100/40 via-white to-white" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-200/20 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-200/20 rounded-full blur-3xl" />
      </div>

      {/* Header */}

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {deleted && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-sm">
            Application deleted.
          </div>
        )}

        {/* Title + Actions */}
        <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-black">My Projects</h1>
            <p className="text-sm text-gray-700 mt-1">
              {items.length} total · {items.filter(i => i.visibility === 'public').length} public · {items.filter(i => i.visibility === 'unlisted').length} unlisted
            </p>
          </div>
          <div className="flex gap-2">
            {handle && (
              <Link
                href={`/u/${handle}/finances`}
                className="px-5 py-2.5 rounded-full border border-emerald-300 text-emerald-800 bg-white hover:bg-emerald-50 transition shadow-sm"
                title="Pregled financija"
              >
                Financije
              </Link>
            )}
            <Link
              href="/create"
              className="px-5 py-2.5 rounded-full bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-medium hover:from-emerald-700 hover:to-emerald-800 transition-all duration-200 shadow-md hover:shadow-lg"
              title="Create new project"
            >
              Create New
            </Link>
          </div>
        </div>

        {/* Handle setup if missing */}
        {!handle && (
          <section className="mb-6 p-4 rounded-xl bg-white border border-gray-200 shadow-sm">
            <h2 className="text-lg font-semibold mb-1">Postavi korisničko ime (handle)</h2>
            <p className="text-sm text-gray-600 mb-3">Prije postavljanja cijene repozitorija, postavite svoje korisničko ime (npr. amir_dev). Dozvoljeni su mala slova, brojevi, crtica i donja crta. Minimalno 3 znaka.</p>
            <HandleForm onSuccess={(h) => setHandle(h)} />
          </section>
        )}

        {/* Repo-level price */}
        {handle && (
          <section className="mb-6 p-4 rounded-xl bg-white border border-gray-200 shadow-sm">
            <h2 className="text-lg font-semibold mb-2">Cijena repozitorija</h2>
            {!canMonetize && (
              <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded">
                <p className="text-sm mb-2">
                  Postavljanje cijena je zaključano dok ne dovršiš Stripe onboarding.
                </p>
                <button
                  onClick={() => startStripeOnboarding(user!.uid, handle)}
                  className="px-3 py-1 bg-blue-600 text-white rounded"
                >
                  Podesi isplate (Stripe)
                </button>
              </div>
            )}
            {!editingRepoPrice && Number(allAccessPrice || 0) > 0 ? (
              <div className="flex items-center justify-between">
                <div className="text-gray-900">
                  <span className="inline-block px-3 py-1 rounded-full bg-emerald-600 text-white font-semibold">
                    All‑Access {new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format(Number(allAccessPrice))}/mo
                  </span>
                  {repoPriceUpdatedAt && (
                    <span className="ml-3 text-sm text-gray-500">Zadnja promjena: {new Date(repoPriceUpdatedAt).toLocaleString()}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setEditingRepoPrice(true)}
                  className="px-4 py-2 rounded border border-gray-300 text-gray-800 hover:bg-white"
                  disabled={!canMonetize}
                >
                  Uredi
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-600 mb-3">Postavite mjesečnu cijenu za All‑Access (pristup svim vašim aplikacijama). Ako ostavite prazno ili 0, All‑Access je isključen.</p>
                <form onSubmit={saveRepoPrice} className="flex items-end gap-2">
                  <div>
                    <label className="block text-sm text-gray-700">Cijena (USD)</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={allAccessPrice}
                      onChange={(e) => setAllAccessPrice(e.target.value)}
                      className="border px-3 py-2 rounded w-36"
                      disabled={!canMonetize}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={savingPrice || !canMonetize}
                    className="px-4 py-2 rounded bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {savingPrice ? 'Spremanje…' : 'Spremi'}
                  </button>
                  {Number(allAccessPrice || 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => setEditingRepoPrice(false)}
                      className="px-4 py-2 rounded border border-gray-300 text-gray-800 hover:bg-white"
                    >
                      Odustani
                    </button>
                  )}
                </form>
              </>
            )}
          </section>
        )}

        {/* Filters */}
        <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="col-span-1 md:col-span-1">
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5">
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M10 18a8 8 0 100-16 8 8 0 000 16z" />
              </svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by title, tag, description..."
                className="w-full outline-none bg-transparent text-sm text-gray-900 placeholder:text-gray-500"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            {(['all','public','unlisted'] as const).map(v => (
              <button
                key={v}
                onClick={() => setVisibilityFilter(v)}
                className={cn(
                  'flex-1 py-2.5 px-3 rounded-lg text-sm font-medium border transition-all duration-200',
                  visibilityFilter === v
                    ? 'bg-white border-emerald-400 text-emerald-700 shadow-sm'
                    : 'bg-white border-gray-200 text-gray-800 hover:border-gray-300'
                )}
              >
                {v === 'all' ? 'All' : v === 'public' ? 'Public' : 'Unlisted'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-700">Sort</label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as any)}
              className="flex-1 py-2.5 px-3 rounded-lg text-sm border border-gray-200 bg-white text-gray-900"
            >
              <option value="newest">Newest</option>
              <option value="likes">Most liked</option>
              <option value="title">Title A–Z</option>
            </select>
          </div>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-200 shadow-md overflow-hidden animate-pulse">
                <div className="aspect-video bg-gray-200" />
                <div className="p-4">
                  <div className="h-6 bg-gray-200 rounded w-3/4 mb-2" />
                  <div className="h-4 bg-gray-200 rounded w-full mb-2" />
                  <div className="h-4 bg-gray-200 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-gray-700 py-16">
            <p className="text-lg mb-4">No matching projects. Try adjusting filters.</p>
            <Link href="/create" className="px-6 py-3 rounded-full bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition" title="Create your first project">Create Your First Project</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((it) => {
              const likeDisplay = it.likesCount ?? 0;
              const isNew = it.createdAt && Date.now() - it.createdAt < 1000 * 60 * 60 * 24 * 7;
              const img = imgSrc(it);
              const hasPreview = Boolean(img);

              return (
                <article
                  key={it.slug}
                  className="group bg-white border border-gray-200 rounded-2xl shadow-md overflow-hidden flex flex-col transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5"
                >
                  <div className="relative">
                    <Link href={{ pathname: '/app', query: { slug: it.slug } }} title={it.title}>
                      {hasPreview ? (
                        <img
                          src={img}
                          alt={it.title}
                          className="w-full aspect-video object-cover"
                        />
                      ) : (
                        <div className="w-full aspect-video bg-slate-100 flex items-center justify-center text-slate-500 text-xs font-medium">
                          Bez grafike
                        </div>
                      )}
                    </Link>

                    {/* Badges */}
                    <div className="absolute top-3 left-3 flex items-center gap-2">
                    {isNew && (
                      <span className="px-2.5 py-1 rounded-full bg-emerald-600 text-white text-[11px] font-bold shadow">NEW</span>
                    )}
                    {it.state === 'inactive' && (
                      <span className="px-2.5 py-1 rounded-full bg-red-600 text-white text-[11px] font-bold shadow">INACTIVE</span>
                    )}
                    {it.status === 'pending-review' && (
                      <span className="px-2.5 py-1 rounded-full bg-amber-500 text-white text-[11px] font-bold shadow">NA ČEKANJU</span>
                    )}
                    {it.status === 'rejected' && (
                      <span className="px-2.5 py-1 rounded-full bg-red-700 text-white text-[11px] font-bold shadow">ODBIJENO</span>
                    )}
                    <span
                      className={cn(
                        'px-2.5 py-1 rounded-full text-[11px] font-bold shadow',
                        it.visibility === 'public'
                          ? 'bg-gray-900 text-white'
                          : 'bg-gray-200 text-gray-900'
                        )}
                      >
                        {(it.visibility ?? 'public').toUpperCase()}
                      </span>
                    {/* Price badge */}
                    <span className="px-2.5 py-1 rounded-full bg-gray-900/90 text-white text-[11px] font-bold shadow">
                      {typeof (it as any).price === 'number' && (it as any).price > 0
                        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((it as any).price) + '/mo'
                        : 'FREE'}
                    </span>
                    </div>

                    {/* Hover CTA */}
                      {it.status === 'published' && (
                        <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end justify-center pb-4">
                          <button
                            type="button"
                            onClick={(e) => handlePlayClick(e, it)}
                            className="px-4 py-2 rounded-full bg-white/95 backdrop-blur text-gray-900 text-sm font-medium shadow-lg hover:bg-white transform hover:scale-105 transition"
                            title="Play in new tab"
                          >
                            ▶ Play in New Tab
                          </button>
                        </div>
                      )}
                  </div>

                  <div className="p-4 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="font-semibold text-lg text-gray-900 line-clamp-1">{it.title}</h2>
                      <button
                        id={`like-${it.slug}`}
                        type="button"
                        onClick={() => toggleLike(it.slug)}
                        className={cn(
                          'flex items-center gap-1 px-2 py-1 rounded-full border text-sm transition-all duration-200',
                          it.likedByMe
                            ? 'bg-red-50 border-red-300 text-red-600 hover:bg-red-100'
                            : 'bg-white border-gray-300 text-gray-800 hover:bg-gray-50',
                          busy[it.slug] && 'opacity-50 cursor-not-allowed'
                        )}
                        title="Like"
                        aria-label={it.likedByMe ? 'Unlike' : 'Like'}
                        aria-pressed={!!it.likedByMe}
                        disabled={busy[it.slug]}
                      >
                        <svg className="w-4 h-4" fill={it.likedByMe ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                        </svg>
                        <span className="font-medium">{likeDisplay}</span>
                      </button>
                    </div>

                    {it.description && (
                      <p className="text-sm text-gray-700 mt-1 line-clamp-2">{it.description}</p>
                    )}
                    {(it.status === 'pending-review' || it.status === 'rejected') && (
                      <p
                        className={`text-xs mt-1 ${
                          it.status === 'rejected' ? 'text-red-600' : 'text-amber-600'
                        }`}
                      >
                        {it.status === 'rejected' ? 'Odbijeno' : 'Čeka odobrenje'}
                        {it.moderation?.reasons?.length
                          ? `: ${it.moderation.reasons
                              .map((r) => translateReason(r))
                              .join(', ')}`
                          : ''}
                      </p>
                    )}

                    {it.tags?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {it.tags.map((t) => (
                          <Link
                            key={t}
                            href={`/?tag=${t}`}
                            className="text-[11px] px-2 py-1 rounded-full bg-gradient-to-r from-gray-50 to-gray-100 border border-gray-300 font-medium text-gray-800 hover:from-emerald-50 hover:to-green-50 hover:border-emerald-400 hover:text-emerald-700 transition-all duration-200"
                            title={`Tag: ${t}`}
                          >
                            #{t}
                          </Link>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-3 flex items-center justify-between text-xs text-gray-600">
                      <span title={it.createdAt ? new Date(it.createdAt).toLocaleString() : ''}>
                        <RelativeTime ts={it.createdAt} />
                      </span>
                      <div className="flex items-center gap-3">
                        {typeof it.playCount === 'number' && (
                          <span className="inline-flex items-center gap-1" title="Times played">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                            {it.playCount}
                          </span>
                        )}
                        <button
                          onClick={() => copyLink(it)}
                          className="inline-flex items-center gap-1 text-gray-800 hover:text-gray-900 transition"
                          title="Copy play link"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          Copy
                        </button>
                      </div>
                    </div>
                  </div>

                    <div className="p-4 border-t bg-gray-50/60 flex gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={(e) => handlePlayClick(e, it)}
                        className="flex-1 text-center px-4 py-2 rounded-full bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition shadow-sm hover:shadow"
                        title="Play app"
                      >
                        Play
                      </button>
                      <button
                        onClick={() => router.push(`/app?slug=${encodeURIComponent(it.slug)}`)}
                        className={cn(
                          'flex-1 text-center px-4 py-2 rounded-full border text-sm font-medium transition',
                          busy[it.slug]
                            ? 'border-gray-300 text-gray-400 cursor-not-allowed'
                          : 'border-gray-300 text-gray-800 hover:bg-white'
                      )}
                      disabled={busy[it.slug]}
                      title="Edit details"
                    >
                      Edit
                    </button>
                    {/* Delete action removed on My Projects page; available in app details */}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Animations */}
      <style jsx global>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideInRight { from { opacity: 0; transform: translateX(100px); } to { opacity: 1; transform: translateX(0); } }
        .animate-fadeIn { animation: fadeIn 0.2s ease-out; }
        .animate-slideUp { animation: slideUp 0.3s ease-out; }
        .animate-slideInRight { animation: slideInRight 0.3s ease-out; }
      `}</style>
    </div>
  );
}

function HandleForm({ onSuccess }: { onSuccess: (h: string) => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const h = value.trim().toLowerCase();
    if (!/^[a-z0-9_-]{3,}$/.test(h)) {
      setErr('Dozvoljena su mala slova, brojevi, - i _. Min 3 znaka.');
      return;
    }
    setBusy(true);
    try {
      const headers: any = await buildHeaders(true);
      const res = await fetch(`${API_URL}/creators/me/handle`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ handle: h }),
      });
      if (res.status === 409) {
        setErr('Korisničko ime je zauzeto. Pokušajte drugo.');
        return;
      }
      if (!res.ok) throw new Error('bad_response');
      onSuccess(h);
    } catch {
      setErr('Spremanje nije uspjelo');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <div>
        <label className="block text-sm text-gray-700">Handle</label>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="border px-3 py-2 rounded w-48"
          placeholder="npr. amir_dev"
        />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="px-4 py-2 rounded bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60"
      >
        {busy ? 'Spremanje…' : 'Spremi handle'}
      </button>
      {err && <span className="text-sm text-red-600 ml-2">{err}</span>}
    </form>
  );
}

