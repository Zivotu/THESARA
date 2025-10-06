"use client";

import { Suspense, useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouteParam } from '@/hooks/useRouteParam';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/lib/config';
import { useAuth } from '@/lib/auth';

export default function CheckoutPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutClient />
    </Suspense>
  );
}

function CheckoutClient() {
  const appId = useRouteParam('appId', (segments) => {
    if (segments.length > 1 && segments[0] === 'checkout') {
      return segments[1] ?? '';
    }
    if (segments.length > 1 && segments[0] === 'app') {
      return segments[1] ?? '';
    }
    return undefined;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const router = useRouter();
  const { user } = useAuth();

  const [customerEmail, setCustomerEmail] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState(appId);
  const [priceAmount, setPriceAmount] = useState<number | null>(null);
  const [currency, setCurrency] = useState('USD');

  useEffect(() => {
    if (user?.email) setCustomerEmail(user.email);
  }, [user?.email]);

  useEffect(() => {
    if (!appId) {
      setLoading(false);
      setLoadError('Nedostaje ID aplikacije.');
      return;
    }
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(`${API_URL}/listing/${appId}`);
        if (!res.ok) throw new Error('bad_response');
        const json = await res.json();
        setTitle(json?.item?.title || appId);
        const p = json?.item?.price;
        if (typeof p === 'number') setPriceAmount(p);
        const cur = json?.item?.currency;
        if (typeof cur === 'string') setCurrency(cur.toUpperCase());
      } catch {
        setLoadError('Greška pri učitavanju podataka');
      } finally {
        setLoading(false);
      }
    })();
  }, [appId]);

  const price =
    priceAmount != null
      ? new Intl.NumberFormat('hr-HR', {
          style: 'currency',
          currency,
        }).format(priceAmount)
      : null;

  async function startCheckout() {
    setBusy(true);
    setError(null);
    try {
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = crypto.randomUUID();
      }
      const token = await (user as any)?.getIdToken?.();
      if (!token) {
        router.push('/login');
        return;
      }
      let url = `${API_URL}/billing/subscriptions/app`;
      let body: any;
        if (appId === 'gold' || appId === 'no-ads') {
          url = `${API_URL}/billing/subscriptions/${appId}`;
          body = {
            customerEmail: customerEmail || undefined,
          };
        } else {
          body = {
            appId,
            customerEmail: customerEmail || undefined,
            idempotencyKey: idempotencyKeyRef.current,
          };
        }
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('bad_response');
      const json = await res.json();
      if (json?.url) {
        window.location.href = json.url as string;
        return;
      }
      setError('Neispravan odgovor poslužitelja');
    } catch {
      setError('Greška pri komunikaciji s API-jem');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-md mx-auto space-y-4">
        <h1 className="text-2xl font-bold text-center">Pregled narudžbe</h1>

        {loading ? (
          <p className="text-center">Učitavanje…</p>
        ) : loadError ? (
          <p className="text-red-500 text-center">{loadError}</p>
        ) : (
          <>
            <section className="bg-white rounded-lg shadow p-4 space-y-2">
              <div className="flex justify-between">
                <span className="font-semibold">Pretplata</span>
                <span>{title}</span>
              </div>
              {price && (
                <div className="flex justify-between">
                  <span className="font-semibold">Cijena</span>
                  <span>{price}</span>
                </div>
              )}
            </section>

            <section className="bg-white rounded-lg shadow p-4 space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email za račun
              </label>
              <input
                id="email"
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="w-full border rounded px-3 py-2"
              />
            </section>

            <button
              onClick={startCheckout}
              disabled={busy}
              className="w-full py-3 rounded-lg bg-emerald-600 text-white font-medium disabled:opacity-50"
            >
              {busy ? 'Slanje…' : 'Nastavi'}
            </button>
            {error && <p className="text-red-500">{error}</p>}
            <Link
              href={{ pathname: '/paywall', query: { slug: appId } }}
              className="block text-center text-emerald-600 underline"
            >
              ← Natrag
            </Link>
          </>
        )}
      </div>
    </main>
  );
}











