"use client";

import Link from 'next/link';
import { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useRouteParam } from '@/hooks/useRouteParam';
import Head from 'next/head';
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import type { AccessMode } from '@/lib/types';
import {
  listEntitlements,
  addEntitlement,
  removeEntitlement,
} from '@/lib/entitlements';
import type { EntitlementType } from '@loopyway/entitlements';
import { apiGet, apiPost } from '@/lib/api';
import {
  useConnectStatus,
  startStripeOnboarding,
} from '@/hooks/useConnectStatus';
import { ApiProvider } from '@/components/ApiProvider';
import { useApi } from '@/hooks/useApi';

type Entitlement = {
  id: string;
  feature: string;
  userId: string;
};

function CreatorAdminPage() {
  const handle = useRouteParam('handle', (segments) => {
    if (segments.length > 2 && segments[0] === 'u' && segments[1] === 'admin') {
      return segments[2] ?? '';
    }
    if (segments.length > 1 && segments[0] === 'u') {
      return segments[1] ?? '';
    }
    return undefined;
  });
  const safeHandle = handle ? encodeURIComponent(handle) : '';
  const router = useRouter();
  const { user, loading } = useAuth();
  const { apiCall } = useApi();

  const [items, setItems] = useState<Entitlement[]>([]);
  const [feature, setFeature] = useState('');
  const [busy, setBusy] = useState(false);

  const [accessMode, setAccessMode] = useState<AccessMode>('public');
  const [pin, setPin] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'unlisted'>('public');
  const [ads, setAds] = useState(false);
  const [allAccessPrice, setAllAccessPrice] = useState<number | ''>(0);
  const connect = useConnectStatus();
  const canMonetize =
    connect?.payouts_enabled && (connect.requirements_due ?? 0) === 0;

  const loadEntitlements = useCallback(async () => {
    const items = await apiCall(listEntitlements(handle));
    if (items) setItems(items);
  }, [apiCall, handle]);

  const loadCreator = useCallback(async () => {
    const json = await apiCall(
      apiGet<{
        accessMode?: string;
        visibility?: string;
        ads?: boolean;
        allAccessPrice?: number;
      }>(`/creators/${handle}`)
    );
    if (!json) return;
    if (json.accessMode) setAccessMode(json.accessMode as AccessMode);
    if (json.visibility) setVisibility(json.visibility as 'public' | 'unlisted');
    if (typeof json.ads === 'boolean') setAds(json.ads);
    if (typeof json.allAccessPrice === 'number')
      setAllAccessPrice(json.allAccessPrice);
  }, [apiCall, handle]);

  useEffect(() => {
    if (!loading && user?.uid === handle) {
      loadCreator();
      loadEntitlements();
    }
  }, [user, loading, handle, loadCreator, loadEntitlements]);

  useEffect(() => {
    if (!loading && (!user || user.uid !== handle)) {
      router.replace(`/u/${handle}`);
    }
  }, [user, loading, handle, router]);

  async function addBadge(e: React.FormEvent) {
    e.preventDefault();
    if (!feature.trim()) return;
    setBusy(true);
    const ent: EntitlementType = feature.trim() as unknown as EntitlementType;
    const result = await apiCall(
      addEntitlement({ userId: handle, feature: ent })
    );
    if (result) {
      setFeature('');
      await loadEntitlements();
    }
    setBusy(false);
  }

  async function remove(id: string) {
    setBusy(true);
    const result = await apiCall(removeEntitlement(handle, id));
    if (result) {
      await loadEntitlements();
    }
    setBusy(false);
  }

  async function saveAccessMode(e: React.FormEvent) {
    e.preventDefault();
    if (!accessMode) return;
    setBusy(true);
    await apiCall(
      apiPost(`/creators/${handle}`, { accessMode }, { method: 'PATCH' })
    );
    setBusy(false);
  }

  async function updatePin(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4,}$/.test(pin)) {
      // TODO: show error
      return;
    }
    setBusy(true);
    await apiCall(apiPost(`/creators/${handle}`, { pin }, { method: 'PATCH' }));
    setBusy(false);
  }

  async function clearPin() {
    setBusy(true);
    const result = await apiCall(
      apiPost(`/creators/${handle}`, { pin: null }, { method: 'PATCH' })
    );
    if (result) {
      setPin('');
    }
    setBusy(false);
  }

  async function saveVisibility(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await apiCall(
      apiPost(`/creators/${handle}`, { visibility }, { method: 'PATCH' })
    );
    setBusy(false);
  }

  async function saveAllAccessPrice(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const price = allAccessPrice === '' ? 0 : Number(allAccessPrice);
    await apiCall(
      apiPost(`/creators/${handle}`, { allAccessPrice: price }, { method: 'PATCH' })
    );
    setBusy(false);
  }

  async function saveAds(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await apiCall(apiPost(`/creators/${handle}`, { ads }, { method: 'PATCH' }));
    setBusy(false);
  }

  return (
    <>
      <Head>
        <title>Admin kreatora</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="p-4 max-w-2xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold">Admin @{handle}</h1>

        <section className="bg-white rounded shadow p-4 space-y-4">
          <h2 className="text-xl font-semibold">Način pristupa</h2>
          <p className="text-sm text-gray-600">
            Odaberite kako korisnici otključavaju vaš sadržaj.
          </p>
          <form onSubmit={saveAccessMode} className="flex gap-2 items-center">
            <select
              value={accessMode}
              onChange={(e) => setAccessMode(e.target.value as AccessMode)}
              className="border px-2 py-1 rounded"
            >
              <option value="public">public</option>
              <option value="pin">pin</option>
              <option value="invite">invite</option>
              <option value="private">private</option>
            </select>
            <button
              type="submit"
              disabled={busy}
              className="px-3 py-1 bg-blue-600 text-white rounded"
            >
              Spremi
            </button>
          </form>
        </section>

        <section className="bg-white rounded shadow p-4 space-y-4">
          <h2 className="text-xl font-semibold">PIN</h2>
          <p className="text-sm text-gray-600">
            Ako koristite PIN pristup, postavite ili uklonite PIN ovdje.
          </p>
          <form onSubmit={updatePin} className="flex gap-2 items-end">
            <div className="flex flex-col">
              <label htmlFor="pin" className="text-sm text-gray-600">
                PIN
              </label>
              <input
                id="pin"
                type="text"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="border px-2 py-1 rounded w-32"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="px-3 py-1 bg-blue-600 text-white rounded"
            >
              Postavi
            </button>
            <button
              type="button"
              onClick={clearPin}
              disabled={busy}
              className="px-3 py-1 bg-gray-300 rounded"
            >
              Ukloni
            </button>
          </form>
        </section>

        <section className="bg-white rounded shadow p-4 space-y-4">
          <h2 className="text-xl font-semibold">Vidljivost</h2>
          <p className="text-sm text-gray-600">
            Kontrolirajte je li vaš profil javno vidljiv.
          </p>
          <form onSubmit={saveVisibility} className="flex gap-2 items-center">
            <select
              value={visibility}
              onChange={(e) =>
                setVisibility(e.target.value as 'public' | 'unlisted')
              }
              className="border px-2 py-1 rounded"
            >
              <option value="public">public</option>
              <option value="unlisted">unlisted</option>
            </select>
            <button
              type="submit"
              disabled={busy}
              className="px-3 py-1 bg-blue-600 text-white rounded"
            >
              Spremi
            </button>
          </form>
        </section>

        <section className="bg-white rounded shadow p-4 space-y-4">
          <h2 className="text-xl font-semibold">Cijena repozitorija</h2>
          {!canMonetize && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded">
              <p className="text-sm mb-2">
                Postavljanje cijena je zaključano dok ne dovršiš Stripe
                onboarding.
              </p>
              <button
                onClick={() => {
                  if (!user?.uid) return;
                  apiCall(startStripeOnboarding(user.uid, handle));
                }}
                className="px-3 py-1 bg-blue-600 text-white rounded"
              >
                Podesi isplate (Stripe)
              </button>
            </div>
          )}
          <p className="text-sm text-gray-600">
            Postavite mjesečnu cijenu za pristup svim vašim aplikacijama. Postavite
            0 za besplatno.
          </p>
          <form onSubmit={saveAllAccessPrice} className="flex gap-2 items-center">
            <input
              type="number"
              min={0}
              step="0.01"
              value={allAccessPrice}
              onChange={(e) =>
                setAllAccessPrice(e.target.value === '' ? '' : Number(e.target.value))
              }
              className="border px-2 py-1 rounded w-32"
              disabled={!canMonetize}
            />
            <button
              type="submit"
              disabled={busy || !canMonetize}
              className="px-3 py-1 bg-blue-600 text-white rounded"
            >
              Spremi
            </button>
          </form>
        </section>

        <section className="bg-white rounded shadow p-4 space-y-4">
          <h2 className="text-xl font-semibold">Oglašavanje</h2>
          <p className="text-sm text-gray-600">
            Uključite ili isključite prikaz oglasa na vašim stranicama.
          </p>
          <form onSubmit={saveAds} className="flex gap-2 items-center">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={ads}
                onChange={(e) => setAds(e.target.checked)}
              />
              Oglašavanje
            </label>
            <button
              type="submit"
              disabled={busy}
              className="px-3 py-1 bg-blue-600 text-white rounded"
            >
              Spremi
            </button>
          </form>
        </section>

        <section className="bg-white rounded shadow p-4 space-y-4">
          <h2 className="text-xl font-semibold">Badgevi</h2>
          <p className="text-sm text-gray-600">
            Dodajte ili uklonite posebne značke za vaš profil.
          </p>
          <form onSubmit={addBadge} className="flex gap-2">
            <input
              type="text"
              value={feature}
              onChange={(e) => setFeature(e.target.value)}
              className="border px-2 py-1 rounded flex-1"
              placeholder="Novi badge"
            />
            <button
              type="submit"
              disabled={busy}
              className="px-3 py-1 bg-blue-600 text-white rounded"
            >
              Dodaj
            </button>
          </form>
          {items.length > 0 ? (
            <ul className="space-y-2">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="flex justify-between items-center border p-2 rounded"
                >
                  <span>{it.feature}</span>
                  <button
                    onClick={() => remove(it.id)}
                    disabled={busy}
                    className="text-red-500 text-sm"
                  >
                    Ukloni
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500">Nema badgeva.</p>
          )}
        </section>

        <Link
          href={`/u/${handle}`}
          prefetch={false}
          className="inline-block text-blue-500 underline"
          title="Back to profile"
        >
          ← Profil
        </Link>
      </div>
    </>
  );
}

export default function CreatorAdminPageWrapper() {
  return (
    <Suspense fallback={null}>
      <ApiProvider>
        <CreatorAdminPage />
      </ApiProvider>
    </Suspense>
  );
}
