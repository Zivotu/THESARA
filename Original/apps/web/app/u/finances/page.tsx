"use client";

import { Suspense, useEffect, useState } from 'react';
import { useRouteParam } from '@/hooks/useRouteParam';
import { API_URL } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { apiGet } from '@/lib/api';
import { startStripeOnboarding, openStripeDashboard } from '@/hooks/useConnectStatus';
import { useSafeSearchParams } from '@/hooks/useSafeSearchParams';

type Metrics = {
  allAccess: {
    priceId?: string;
    unitAmount?: number;
    active: number;
    monthlyEstimateGross?: number;
    monthlyEstimateCreator?: number;
  };
  apps: Array<{
    appId: string;
    priceId?: string;
    unitAmount?: number;
    active: number;
    creatorMonthly?: number;
  }>;
  totals: { monthlyEstimateGross?: number; monthlyEstimateCreator?: number };
};

function formatUSD(cents?: number) {
  if (typeof cents !== 'number') return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export default function CreatorFinancesPage() {
  return (
    <Suspense fallback={null}>
      <CreatorFinancesClient />
    </Suspense>
  );
}

function CreatorFinancesClient() {
  const handle = useRouteParam('handle', (segments) => {
    if (segments.length > 2 && segments[0] === 'u' && segments[1] === 'finances') {
      return segments[2] ?? '';
    }
    if (segments.length > 1 && segments[0] === 'u') {
      return segments[1] ?? '';
    }
    return undefined;
  });
  const safeHandle = handle ? encodeURIComponent(handle) : '';
  const searchParams = useSafeSearchParams();
  const { user } = useAuth();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connect, setConnect] = useState<{
    onboarded?: boolean;
    payouts_enabled?: boolean;
    requirements_due?: number;
  } | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await (user as any)?.getIdToken?.();
        const res = await fetch(`${API_URL}/creators/${encodeURIComponent(handle)}/metrics`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) throw new Error('bad_response');
        const json = await res.json();
        setMetrics(json.metrics);
      } catch {
        setError('Nije moguće učitati financije.');
      } finally {
        setLoading(false);
      }
    })();
  }, [handle, user]);

  useEffect(() => {
    if (!user?.uid) return;
    apiGet<{ onboarded?: boolean; payouts_enabled?: boolean; requirements_due?: number }>(
      `/billing/connect/status?creatorId=${encodeURIComponent(user.uid)}`,
      { auth: true },
    )
      .then(setConnect)
      .catch(() => setConnect(null));
  }, [user]);

  const onboardingDone = searchParams.get('onboarding') === '1';

  async function handleOnboard() {
    if (!user?.uid) return;
    try {
      await startStripeOnboarding(user.uid, handle);
    } catch {}
  }

  async function handleDashboard() {
    if (!user?.uid) return;
    try {
      await openStripeDashboard(user.uid);
    } catch {}
  }

  return (
    <main className="max-w-4xl mx-auto p-4 md:p-6">
      <h1 className="text-2xl font-bold mb-4">Financije @{handle}</h1>
      {onboardingDone && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 text-green-800">
          Onboarding dovršen
        </div>
      )}
      {connect &&
        (!connect.onboarded ||
          !connect.payouts_enabled ||
          (connect.requirements_due ?? 0) > 0) && (
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200">
            <p className="text-sm mb-2 text-blue-900">
              Isplate stižu ~3 dana nakon uplate, a kreator dobiva 70% prihoda.
            </p>
            <div className="space-x-2">
              <button
                onClick={handleOnboard}
                className="px-3 py-1 bg-blue-600 text-white rounded"
              >
                Postavi isplate
              </button>
              {connect.onboarded && (
                <button
                  onClick={handleDashboard}
                  className="px-3 py-1 bg-gray-300 rounded"
                >
                  Dashboard
                </button>
              )}
            </div>
          </div>
        )}
      {loading && <p>Učitavanje…</p>}
      {error && <p className="text-red-600">{error}</p>}
      {metrics && (
        <div className="space-y-6">
          <section className="bg-white border rounded-lg p-4 shadow-sm">
            <h2 className="text-lg font-semibold mb-2">All‑Access (repozitorij)</h2>
            <p>Aktivnih pretplatnika: <strong>{metrics.allAccess.active}</strong></p>
            <p>Cijena: <strong>{formatUSD(metrics.allAccess.unitAmount)}</strong></p>
            <p>
              Procjena mjesečnog prihoda:{' '}
              <strong>{formatUSD(metrics.allAccess.monthlyEstimateGross)}</strong>
            </p>
            <p>
              Procjena mjesečnog prihoda{' '}
              <span className="text-gray-600">(70% bez Stripe naknada)</span>: <strong>
                {formatUSD(metrics.allAccess.monthlyEstimateCreator)}
              </strong>
            </p>
          </section>

          <section className="bg-white border rounded-lg p-4 shadow-sm">
            <h2 className="text-lg font-semibold mb-2">Pretplate po aplikaciji</h2>
            {metrics.apps.length === 0 ? (
              <p className="text-gray-600">Nema aplikacija s cijenom.</p>
            ) : (
              <ul className="divide-y">
                {metrics.apps.map((a) => (
                  <li key={a.appId} className="py-2 flex items-center justify-between">
                    <div>
                      <div className="font-medium">App ID: {a.appId}</div>
                      <div className="text-sm text-gray-600">Aktivnih: {a.active}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm">Cijena: {formatUSD(a.unitAmount)}</div>
                      <div className="text-sm font-semibold">
                        Prihod/mj: {formatUSD((a.unitAmount ?? 0) * a.active)}
                      </div>
                      <div className="text-sm">
                        Prihod/mj{' '}
                        <span className="text-gray-600">(70% bez Stripe naknada)</span>:{' '}
                        {formatUSD(a.creatorMonthly)}
                      </div>
                    </div>
                    </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-white border rounded-lg p-4 shadow-sm">
            <h2 className="text-lg font-semibold mb-2">Ukupno</h2>
            <p>
              Procjena mjesečnog prihoda:{' '}
              <strong>{formatUSD(metrics.totals.monthlyEstimateGross)}</strong>
            </p>
            <p>
              Procjena mjesečnog prihoda{' '}
              <span className="text-gray-600">(70% bez Stripe naknada)</span>: <strong>
                {formatUSD(metrics.totals.monthlyEstimateCreator)}
              </strong>
            </p>
          </section>
        </div>
      )}
    </main>
  );
}

