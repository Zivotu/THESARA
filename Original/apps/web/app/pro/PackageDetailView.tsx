'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PackageCard from '@/components/PackageCard';
import { apiFetch } from '@/lib/api';

interface BillingPackage {
  id: string;
  name: string;
  description?: string;
  features?: string[];
  tier?: string;
  priceId: string;
  price?: number;
  currency?: string;
}

interface PackageDetailViewProps {
  packageId: string;
}

export default function PackageDetailView({ packageId }: PackageDetailViewProps) {
  const router = useRouter();
  const [packages, setPackages] = useState<BillingPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!packageId) {
        setError('Missing package id.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<BillingPackage[]>(`/billing/packages`);
        if (!cancelled) {
          setPackages(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load packages.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [packageId]);

  const current = useMemo(
    () => packages.find((pkg) => pkg.id === packageId),
    [packages, packageId],
  );
  const others = useMemo(
    () => packages.filter((pkg) => pkg.id !== packageId),
    [packages, packageId],
  );

  useEffect(() => {
    if (!loading && !error && packageId && !current) {
      router.replace('/pro');
    }
  }, [current, error, loading, packageId, router]);

  if (loading) {
    return (
      <main className="p-4 md:p-8 lg:p-12">
        <p className="text-gray-500">Loading package...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="p-4 md:p-8 lg:p-12">
        <p className="text-red-600">{error}</p>
      </main>
    );
  }

  if (!current) {
    return (
      <main className="p-4 md:p-8 lg:p-12">
        <p className="text-gray-500">Package not found.</p>
      </main>
    );
  }

  return (
    <main className="p-4 space-y-8 md:p-8 lg:p-12">
      <h1 className="text-3xl font-bold text-center md:text-4xl">{current.name}</h1>
      {current.tier && <p className="text-center text-sm text-gray-500">Tier: {current.tier}</p>}
      {current.description && (
        <p className="max-w-2xl mx-auto text-center text-gray-600">{current.description}</p>
      )}
      <div className="max-w-md mx-auto">
        <PackageCard
          name={current.name}
          description={current.description}
          features={current.features}
          price={current.price}
          currency={current.currency}
          cta="Odaberi"
          href={`/pro/checkout?priceId=${encodeURIComponent(current.id)}`}
        />
      </div>
      {others.length > 0 && (
        <section className="max-w-6xl mx-auto space-y-4">
          <h2 className="text-2xl font-semibold text-center">Usporedba s ostalim paketima</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {others.map((pkg) => (
              <PackageCard
                key={pkg.id}
                name={pkg.name}
                description={pkg.description}
                features={pkg.features}
                price={pkg.price}
                currency={pkg.currency}
                cta="Vidi paket"
                href={`/pro?id=${encodeURIComponent(pkg.id)}`}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
