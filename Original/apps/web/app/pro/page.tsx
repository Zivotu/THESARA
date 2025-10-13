"use client";

import React, { Suspense, useEffect, useState } from 'react';
import { API_URL } from '@/lib/config';
import { useRouter } from 'next/navigation';
import { useRouteParam } from '@/hooks/useRouteParam';
import PackageDetailView from './PackageDetailView';
import { useEntitlements, type Entitlements } from '@/hooks/useEntitlements';
import { useAuth } from '@/lib/auth';
import UserSummary from '@/components/UserSummary';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/lib/i18n-provider';
import { getListingCount } from '@/lib/listings';

type BillingPackage = {
  id: string;
  name: string;
  description?: string;
  priceId: string;
  price?: number;
  currency?: string;
};

type UsageInfo = {
  plan: string;
  apps: { used: number; limit: number | null };
  storage: { used: number; limit: number | null };
};

type SubscribedApp = { id: string; slug: string; title: string };

export default function ProPage() {
  return (
    <Suspense fallback={null}>
      <ProPageClient />
    </Suspense>
  );
}

function ProPageClient() {
  const router = useRouter();
  const packageId = useRouteParam('id', (segments) => {
    if (segments.length > 1 && segments[0] === 'pro') {
      return segments[1] ?? '';
    }
    return undefined;
  });
  const { locale, messages } = useI18n();
  const tPro = (k: string) => messages[`Pro.${k}`] || k;
  const [packages, setPackages] = useState<BillingPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const { data: entitlements, loading: entitlementsLoading } = useEntitlements();
  const { user } = useAuth();
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [nextPaymentDate, setNextPaymentDate] = useState<string | undefined>(undefined);
  const [subscribedApps, setSubscribedApps] = useState<SubscribedApp[]>([]);
  const [appsCountFallback, setAppsCountFallback] = useState<number | null>(null);

  useEffect(() => {
    if (!user) {
      setUsage(null);
      setSubscribedApps([]);
      setAppsCountFallback(null);
      return;
    }
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`${API_URL}/me/usage`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          setUsage(await res.json());
        }
      } catch (err) {
        console.error('Failed to load usage', err);
      }
    })();
    (async () => {
      try {
        // Fallback count via listings if API usage returns 0
        const count = await getListingCount(user.uid);
        setAppsCountFallback(count);
      } catch {
        setAppsCountFallback(null);
      }
    })();
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`${API_URL}/me/subscribed-apps`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = await res.json();
          const items: any[] = Array.isArray(json?.items) ? json.items : [];
          const mapped: SubscribedApp[] = items.map((it) => ({
            id: String(it.id || ''),
            slug: String(it.slug || ''),
            title: String(it.title || 'App'),
          }));
          // Deduplicate by id
          const seen = new Set<string>();
          const dedup = mapped.filter((a) => (a.id && !seen.has(a.id) ? (seen.add(a.id), true) : false));
          setSubscribedApps(dedup);
        } else {
          setSubscribedApps([]);
        }
      } catch {
        setSubscribedApps([]);
      }
    })();
  }, [user]);

  useEffect(() => {
    const fetchPackages = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`${API_URL}/billing/packages`);
        if (!response.ok) {
          throw new Error('Failed to fetch packages');
        }
        const data = await response.json();
        setPackages(data);
      } catch (err) {
        setPackages([]);
        setError(tPro('loadError'));
      } finally {
        setLoading(false);
      }
    };

    fetchPackages();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!user) return;
        const token = await user.getIdToken();
        const res = await fetch(`${API_URL}/billing/transactions`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setNextPaymentDate(data?.nextPaymentDate);
        }
      } catch (e) {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const goToCheckout = async (pkg: BillingPackage) => {
    setCheckoutLoading(pkg.id);
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      router.push(`/pro/checkout?priceId=${encodeURIComponent(pkg.id)}`);
    } catch (err) {
      console.error('Checkout navigation error:', err);
    } finally {
      setCheckoutLoading(null);
    }
  };

  const LoadingSkeleton = () => (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-screen-2xl mx-auto px-4 py-8">
        <div className="text-center mb-8 space-y-3">
          <div className="h-8 bg-gray-200 rounded w-56 mx-auto animate-pulse" />
          <div className="h-4 bg-gray-200 rounded w-80 mx-auto animate-pulse" />
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="p-6 border border-gray-200 bg-white shadow-sm">
              <div className="space-y-3 animate-pulse">
                <div className="h-6 bg-gray-200 rounded w-2/3"></div>
                <div className="h-4 bg-gray-200 rounded w-full"></div>
                <div className="h-4 bg-gray-200 rounded w-3/5"></div>
                <div className="h-10 bg-gray-200 rounded w-1/2"></div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );

  if (loading || entitlementsLoading) {
    return <LoadingSkeleton />;
  }

  const entitlementMap: { [key: string]: keyof Entitlements | undefined } = {
    gold: 'gold',
    noads: 'noAds',
  };

  const hasPackage = (pkg: BillingPackage) => {
    if (!entitlements) return false;
    const key = entitlementMap[pkg.id];
    if (key) return (entitlements as any)[key];
    return entitlements.purchases.includes(pkg.id);
  };

  const mapLocale = (l: string) => (l === 'hr' ? 'hr-HR' : l === 'de' ? 'de-DE' : 'en-US');
  const formatPrice = (price: number, currency: string) =>
    new Intl.NumberFormat(mapLocale(locale), {
      style: 'currency',
      currency,
    }).format(price / 100);

  const getUsagePercentage = (used: number, limit: number | null) => {
    if (limit === null) return 0;
    return Math.min((used / limit) * 100, 100);
  };

  const recommendedId = 'gold';

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-screen-2xl mx-auto px-4 py-8">
        {/* Title */}
        <div className="text-center mb-8 space-y-2">
          <h1 className="text-4xl font-bold text-gray-900">{tPro('choosePlan')}</h1>
          <p className="text-gray-600">{tPro('subtitle')}</p>
        </div>

        {/* User Snapshot */}
        <div className="mb-6">
          <UserSummary />
        </div>

        {/* Active subscriptions */}
        {entitlements && (entitlements.gold || entitlements.noAds || subscribedApps.length > 0) && (
          <Card className="mb-8 p-6 border border-gray-200 bg-white">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">{locale === 'hr' ? 'Aktivne pretplate' : (messages['Pro.activeSubscriptions'] || 'Active subscriptions')}</h3>
              {nextPaymentDate && (
                <span className="text-sm text-gray-600">{locale === 'hr' ? 'Sljedeća naplata' : (messages['Pro.nextPayment'] || 'Next payment')}: {new Date(nextPaymentDate).toLocaleDateString()}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {entitlements.gold && (
                <span className="px-3 py-1 rounded-full text-sm bg-emerald-50 text-emerald-700 border border-emerald-200">Gold</span>
              )}
              {entitlements.noAds && (
                <span className="px-3 py-1 rounded-full text-sm bg-violet-50 text-violet-700 border border-violet-200">No‑Ads</span>
              )}
              {(() => {
                const maxShow = 6;
                const show = subscribedApps.slice(0, maxShow);
                const rest = Math.max(0, subscribedApps.length - maxShow);
                return (
                  <>
                    {show.map((a) => (
                      <span key={a.id} className="px-3 py-1 rounded-full text-sm bg-blue-50 text-blue-700 border border-blue-200">{a.title}</span>
                    ))}
                    {rest > 0 && (
                      <span className="px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-700 border border-gray-200">+{rest} {locale === 'hr' ? 'više' : 'more'}</span>
                    )}
                  </>
                );
              })()}
            </div>
            <div className="mt-3 text-sm text-gray-600">
              <a href="/billing/history" className="text-blue-600 hover:underline">{locale === 'hr' ? 'Povijest naplate' : (messages['Pro.viewHistory'] || 'View billing history')}</a>
            </div>
          </Card>
        )}

        {/* Usage */}
        {usage && (
          <Card className="mb-8 p-6 border border-gray-200 bg-white">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{tPro('usageTitle')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-4 rounded-lg bg-gray-50 border border-gray-200 text-center">
                <div className="text-xs font-medium text-gray-600 mb-1">{tPro('currentPlan')}</div>
                <div className="text-2xl font-bold text-gray-900">{usage.plan}</div>
              </div>
              <div className="p-4 rounded-lg bg-gray-50 border border-gray-200 text-center">
                <div className="text-xs font-medium text-gray-600 mb-1">{tPro('apps')}</div>
                <div className="text-2xl font-bold text-gray-900">{Math.max(usage.apps.used || 0, appsCountFallback ?? 0)}/{usage.apps.limit ?? '∞'}</div>
                {usage.apps.limit && (
                  <div className="mt-2">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-gray-900 h-2 rounded-full" style={{ width: `${getUsagePercentage(Math.max(usage.apps.used || 0, appsCountFallback ?? 0), usage.apps.limit)}%` }} />
                    </div>
                  </div>
                )}
              </div>
              <div className="p-4 rounded-lg bg-gray-50 border border-gray-200 text-center">
                <div className="text-xs font-medium text-gray-600 mb-1">{tPro('storage')}</div>
                <div className="text-2xl font-bold text-gray-900">{usage.storage.used}/{usage.storage.limit ?? '∞'}</div>
                {usage.storage.limit && (
                  <div className="mt-2">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-gray-900 h-2 rounded-full" style={{ width: `${getUsagePercentage(usage.storage.used, usage.storage.limit)}%` }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Error */}
        {error && (
          <Card className="mb-8 p-4 border border-red-200 bg-red-50">
            <p className="text-sm text-red-700">{error}</p>
          </Card>
        )}

        {/* Packages */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {packages.map((pkg) => {
            const owned = hasPackage(pkg);
            const recommended = pkg.id === recommendedId;
            const isPackageLoading = checkoutLoading === pkg.id;
            return (
              <Card key={pkg.id} className={`p-6 bg-white border ${owned ? 'border-emerald-300' : 'border-gray-200'} shadow-sm`}>
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-xl font-semibold text-gray-900">{pkg.name}</h3>
                  {owned ? (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200">{tPro('subscribed') || 'Aktivno'}</span>
                  ) : recommended ? (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200">{tPro('recommended') || 'Preporučeno'}</span>
                  ) : null}
                </div>
                {pkg.description && <p className="text-sm text-gray-600 mb-4">{pkg.description}</p>}
                {pkg.price != null && pkg.currency && (
                  <div className="text-2xl font-bold text-gray-900 mb-4">{formatPrice(pkg.price, pkg.currency)}</div>
                )}
                <Button
                  className={`w-full ${owned ? 'bg-gray-200 text-gray-600 cursor-default' : 'bg-gray-900 text-white hover:bg-gray-800'}`}
                  onClick={() => !owned && !isPackageLoading && goToCheckout(pkg)}
                  disabled={owned || isPackageLoading}
                >
                  {isPackageLoading ? tPro('loading') : owned ? tPro('subscribed') : tPro('selectPackage')}
                </Button>
              </Card>
            );
          })}
        </div>

        {/* Empty state */}
        {packages.length === 0 && !error && (
          <Card className="mt-8 p-8 text-center border border-gray-200 bg-white">
            <p className="text-gray-600">{tPro('noPackagesTitle') || 'Trenutno nema dostupnih paketa'}</p>
            <p className="text-sm text-gray-500">{tPro('noPackagesText') || 'Provjerite kasnije ili kontaktirajte podršku.'}</p>
          </Card>
        )}
      </div>
    </main>
  );
}
