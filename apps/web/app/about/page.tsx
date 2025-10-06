'use client';

import { useEffect, useMemo, useState } from 'react';

const DEFAULT_HEALTH_URL = 'https://api.thesara.space/healthz';

export default function AboutPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);

  const healthUrl = useMemo(() => {
    const base = process.env.NEXT_PUBLIC_API_URL;
    if (base && /^https?:\/\//i.test(base)) {
      return `${base.replace(/\/$/, '')}/healthz`;
    }
    return DEFAULT_HEALTH_URL;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(healthUrl, { cache: 'no-store' });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        if (!cancelled) {
          setPayload(json || {});
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch health data.');
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
  }, [healthUrl]);

  return (
    <main className="max-w-2xl mx-auto p-6 space-y-4">
      <h1 className="text-3xl font-bold">About Thesara</h1>
      <p className="text-gray-600">
        Static build health check that pings the public API.
      </p>
      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-xl font-semibold mb-2">API Health</h2>
        {loading && <p className="text-gray-500">Checking...</p>}
        {!loading && error && <p className="text-red-600">{error}</p>}
        {!loading && !error && (
          <pre className="rounded bg-gray-900 text-gray-100 p-4 text-sm overflow-x-auto">
            {JSON.stringify(payload, null, 2)}
          </pre>
        )}
      </section>
    </main>
  );
}

