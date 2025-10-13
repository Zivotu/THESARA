'use client';

import { useAuth } from '@/lib/auth';
import { API_URL } from '@/lib/config';
import { useEffect, useState } from 'react';
import { handleFetchError } from '@/lib/handleFetchError';
import { joinUrl } from '@/lib/url';

export type Entitlements = { gold: boolean; noAds: boolean; purchases: string[] };

let cache: Entitlements | null = null;
let inFlight: Promise<Entitlements> | null = null;
let controller: AbortController | null = null;
let lastUid: string | null = null;

export function useEntitlements() {
  const { user } = useAuth();
  const [data, setData] = useState<Entitlements | undefined>(cache ?? undefined);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!user) {
      cache = null;
      lastUid = null;
      controller?.abort();
      controller = null;
      inFlight = null;
      setData(undefined);
      setLoading(false);
      return;
    }

    if (user.uid !== lastUid) {
      cache = null;
      controller?.abort();
      controller = null;
      inFlight = null;
      lastUid = user.uid;
    }

    if (cache) {
      setData(cache);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    if (!inFlight) {
      controller = new AbortController();
      inFlight = (async () => {
        const token = await user.getIdToken();
        const res = await fetch(joinUrl(API_URL, '/me/entitlements'), {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const json = await res.json();
        if (res.ok) {
          return json as Entitlements;
        }
        throw new Error(json?.error || 'error');
      })();
    }

    inFlight
      .then((json) => {
        if (cancelled) return;
        cache = json;
        setData(json);
        setError(undefined);
      })
      .catch((err: any) => {
        if (cancelled || err.name === 'AbortError') return;
        handleFetchError(err, 'Failed to load entitlements');
        setError('Failed to load entitlements. Please check the API URL and server status.');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        inFlight = null;
        controller = null;
      });

    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  return { loading, error, data };
}
