'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { API_URL } from '@/lib/config';
import { useI18n } from '@/lib/i18n-provider';

function BuildBadges({ playUrl }: { playUrl: string }) {
  const [policy, setPolicy] = useState<string | null>(null);
  const [domains, setDomains] = useState<string[]>([]);

  useEffect(() => {
    const m = /\/play\/([^/]+)\//.exec(playUrl);
    const appId = m?.[1];
    if (!appId) return;
    const safeAppId = encodeURIComponent(appId);
    let cancelled = false;
    (async () => {
      try {
        const ls = await fetch(`${API_URL}/listing/${safeAppId}`, { credentials: 'include', cache: 'no-store' });
        const lj = ls.ok ? await ls.json() : null;
        const buildId = lj?.item?.buildId;
        if (!buildId) return;
        const safeId = encodeURIComponent(buildId);
        const st = await fetch(`${API_URL}/build/${safeId}/status`, { credentials: 'include', cache: 'no-store' });
        const js = st.ok ? await st.json() : null;
        if (cancelled) return;
        const pol = js?.artifacts?.networkPolicy || null;
        setPolicy(pol);
        try {
          const man = await fetch(`${API_URL}/builds/${safeId}/build/manifest_v1.json`, { credentials: 'include', cache: 'no-store' });
          if (man.ok) {
            const mj = await man.json();
            if (Array.isArray(mj?.networkDomains)) setDomains(mj.networkDomains);
          }
        } catch {}
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [playUrl]);

  if (!policy) return null;
  const pill = (text: string, tone: 'gray'|'green'|'yellow'|'red' = 'gray', title?: string) => (
    <span
      title={title || text}
      className={
        `inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border mr-1 ` +
        (tone==='green' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
         tone==='yellow'? 'bg-amber-50 text-amber-700 border-amber-200' :
         tone==='red'   ? 'bg-rose-50 text-rose-700 border-rose-200' :
                          'bg-gray-50 text-gray-700 border-gray-200')
      }
    >{text}</span>
  );
  const polUp = String(policy).toUpperCase();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {polUp === 'NO_NET' && pill('No Net', 'green', 'bez mrežnih poziva')}
      {polUp === 'MEDIA_ONLY' && pill('Media Only', 'yellow', 'samo slike/video/CDN')}
      {polUp === 'OPEN_NET' && pill('Open Net', 'red', (domains.length? `domene: ${domains.join(', ')}` : 'široki pristup mreži'))}
    </div>
  );
}

type Listing = {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  playUrl: string;
  createdAt: number;
  visibility: 'public' | 'unlisted';
};

export default function AppsPage() {
  const [items, setItems] = useState<Listing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const { locale } = useI18n();
  const lastLocaleRef = useRef<string | null>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((x) =>
      x.title.toLowerCase().includes(q) ||
      (x.description || '').toLowerCase().includes(q) ||
      (x.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  }, [items, query]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/listings?lang=${encodeURIComponent(locale)}`,
          { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { items?: Listing[] };
        setItems((json.items || []).filter((x) => x.visibility !== 'unlisted'));
      } catch (e: any) {
        setError(e.message || 'Error');
      } finally {
        setLoading(false);
      }
    };
    // Run on first mount
    if (lastLocaleRef.current === null) {
      lastLocaleRef.current = locale;
      load();
      return;
    }
    // Re-run only when locale actually changed
    if (lastLocaleRef.current !== locale) {
      lastLocaleRef.current = locale;
      load();
    }
  }, [locale]);

  return (
    <main className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mt-8">Marketplace</h1>
      <p className="text-zinc-400 mt-2">Published apps</p>

      <div className="mt-4 max-w-sm">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search apps..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>

      {error && <div className="text-red-500 mt-4">Error: {error}</div>}

      <div className="grid gap-4 mt-6">
        {loading && <div className="text-zinc-400">Loading…</div>}
        {!loading && filtered.map((x) => (
          <div key={x.id} className="rounded-2xl bg-white border border-gray-200 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">{x.title}</h2>
              <span className="text-xs text-gray-500">{new Date(x.createdAt).toLocaleString()}</span>
            </div>
            {x.description && <p className="text-sm text-gray-600 mt-1">{x.description}</p>}
            {x.tags && x.tags.length > 0 && (
              <div className="mt-2 text-xs text-gray-500">#{x.tags.join(' #')}</div>
            )}
            <BuildBadges playUrl={x.playUrl} />
            <div className="mt-3">
              <a className="underline" href={x.playUrl} target="_blank" rel="noreferrer">
                Play
              </a>
            </div>
          </div>
        ))}
        {!loading && filtered.length === 0 && !error && (
          <div className="text-gray-500">
            No apps yet. <a className="underline" href="/create">Publish one</a>.
          </div>
        )}
      </div>
    </main>
  );
}
