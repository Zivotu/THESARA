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
import { apiFetch, ApiError } from '@/lib/api';
import AppCard, { type Listing } from '@/components/AppCard';
import { useI18n } from '@/lib/i18n-provider';
export {};
function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export default function ProAppsPage() {
  const [handles, setHandles] = useState<Record<string, string>>({});
  const router = useRouter();
  const { messages, locale } = useI18n();
  const tHome = (k: string, params?: Record<string, any>) => {
    let s = messages[`Home.${k}`] || '';
    if (params) for (const [pk, pv] of Object.entries(params)) s = s.replaceAll(`{${pk}}`, String(pv));
    return s || k;
  };
  const [items, setItems] = useState<Listing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user } = useAuth();

  const load = useCallback(() => {
    let retryCount = 0;
    const maxRetries = 3;
    const fetchData = async () => {
      if (!user?.uid) {
        setItems([]);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const json = await apiFetch<{ items: Listing[] }>(`/me/subscribed-apps?lang=${encodeURIComponent(locale)}`, { auth: true });
        setItems(json.items ?? []);
      } catch (e) {
        handleFetchError(e as Error, 'Failed to load subscribed apps');
        if (retryCount < maxRetries) { retryCount++; setTimeout(fetchData, 1000 * retryCount); return; }
        setItems([]);
      } finally { setIsLoading(false); }
    };
    fetchData();
  }, [locale, user?.uid]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // After items are loaded, fetch missing handles for authors
      const missing = (items || []).map(it => it?.author?.uid).filter(Boolean).filter(uid => !(handles as any)[uid!]);
      if (!missing.length) return;
      const map: Record<string, string> = { ...handles };
      for (const uid of missing as string[]) {
        try {
          const res = await fetch(`${API_URL}/creators/id/${encodeURIComponent(uid)}`);
          if (!res.ok) continue;
          const js = await res.json();
          const h = js?.handle || js?.creator?.handle;
          if (h && !cancelled) map[uid] = h;
        } catch {}
      }
      if (!cancelled) setHandles(map);
    })();
    return () => { cancelled = true };
  }, [items]);
  return (
    <div className="min-h-screen text-gray-900 bg-white">
      <section className="max-w-7xl mx-auto px-4 pt-12 pb-6">
        <div className="flex flex-col items-center text-center">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900">
            ProApps
          </h1>
          <p className="mt-3 text-lg text-gray-500 max-w-2xl">Your subscribed applications</p>
        </div>
      </section>
      <main className="max-w-7xl mx-auto px-4 pb-16">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
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
        ) : items.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {items.map((item, i) => (
              <AppCard
                key={item.id}
                item={{
                  ...item,
                  isSubscribed: true,
                  author: { ...item.author, handle: handles[item.author?.uid || ''] || item.author?.handle },
                }}
                toggleLike={() => {}}
                busy={{}}
                viewMode="grid"
                onDetails={() => {}}
                priority={i === 0}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <h3 className="text-2xl font-bold text-gray-900">No subscribed apps yet</h3>
            <p className="mt-2 text-gray-500">Subscribe to some apps to see them here.</p>
          </div>
        )}
      </main>
    </div>
  );
}





