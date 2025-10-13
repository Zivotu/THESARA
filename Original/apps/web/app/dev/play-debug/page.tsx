'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouteParam } from '@/hooks/useRouteParam';
import { API_URL } from '@/lib/config';

async function exists(url: string) {
  try {
    let res = await fetch(url, { method: 'HEAD', cache: 'no-store', redirect: 'follow' });
    if (res.ok) return true;
    res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
      headers: { Range: 'bytes=0-0' },
    });
    return res.ok || res.status === 206;
  } catch {
    return false;
  }
}

interface DebugResult {
  status: Record<string, unknown> | null;
  probes: Record<string, boolean>;
}

export default function DebugPage() {
  return (
    <Suspense fallback={null}>
      <DebugClient />
    </Suspense>
  );
}

function DebugClient() {
  const rawId = useRouteParam('id', (segments) => {
    if (segments.length > 2 && segments[0] === 'dev' && segments[1] === 'play-debug') {
      return segments[2] ?? '';
    }
    return undefined;
  });
  const id = rawId ? encodeURIComponent(rawId) : '';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DebugResult>({ status: null, probes: {} });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!id) {
        setError('Missing build id.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const statusRes = await fetch(`${API_URL}/build/${id}/status`, { cache: 'no-store', credentials: 'include' });
        let status: Record<string, unknown> | null = null;
        if (statusRes.ok) {
          status = await statusRes.json();
          if (status && typeof status === 'object' && 'artifacts' in status) {
            delete (status as any).artifacts;
          }
        }

        const urls = {
          buildsIndex: `${API_URL}/builds/${id}/index.html`,
          buildsDir: `${API_URL}/builds/${id}/`,
          reviewIndex: `${API_URL}/review/builds/${id}/index.html`,
          reviewDir: `${API_URL}/review/builds/${id}/`,
        } as const;

        const probes: Record<string, boolean> = {};
        for (const [key, url] of Object.entries(urls)) {
          probes[key] = await exists(url);
        }

        if (!cancelled) {
          setResult({ status, probes });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load debug data.');
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
  }, [id]);

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Loading debug data...</h1>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Debug info unavailable</h1>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>play-debug: {rawId}</h1>
      <pre>{JSON.stringify(result, null, 2)}</pre>
    </div>
  );
}
