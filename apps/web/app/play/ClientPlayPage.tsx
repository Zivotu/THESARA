'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { apiFetch, ApiError } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { joinUrl } from '@/lib/url';
import { useSafeSearchParams } from '@/hooks/useSafeSearchParams';

type BuildStatusResponse = {
  state?: string;
  artifacts?: { networkPolicy?: string };
};

type ListingResponse = {
  item?: { buildId?: string };
};

const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms';

export default function ClientPlayPage({ appId }: { appId: string }) {
  const searchParams = useSafeSearchParams();
  const run = useMemo(
    () => searchParams.get('run') === '1' || searchParams.get('autoplay') === '1',
    [searchParams],
  );
  const token = useMemo(() => searchParams.get('token') ?? undefined, [searchParams]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [buildId, setBuildId] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [networkPolicy, setNetworkPolicy] = useState<string | undefined>();
  const [networkDomains, setNetworkDomains] = useState<string[]>([]);
  const [appUrl, setAppUrl] = useState<string | null>(null);
  const [fallbackAppUrl, setFallbackAppUrl] = useState<string | null>(null);
  const [iframeHtml, setIframeHtml] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const storageClient = useMemo(() => {
    if (!token) return null;
    return {
      getItem: (roomId: string, key: string) =>
        apiFetch(`/storage/item?roomId=${encodeURIComponent(roomId)}&key=${encodeURIComponent(key)}`, {
          auth: true,
          authToken: token,
          headers: { 'X-Thesara-App-Id': appId },
        }).then((res: any) => res?.value ?? null),
      setItem: (roomId: string, key: string, value: string) =>
        apiFetch('/storage/item', {
          method: 'POST',
          auth: true,
          authToken: token,
          headers: { 'X-Thesara-App-Id': appId },
          body: { roomId, key, value },
        }),
      removeItem: (roomId: string, key: string) =>
        apiFetch(`/storage/item?roomId=${encodeURIComponent(roomId)}&key=${encodeURIComponent(key)}`, {
          method: 'DELETE',
          auth: true,
          authToken: token,
          headers: { 'X-Thesara-App-Id': appId },
        }),
    };
  }, [appId, token]);

  const handleIframeLoad = () => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) {
      console.error('Could not access iframe content window.');
      setError('Failed to initialize the app environment.');
      return;
    }
    // Inject the Thesara client
    (iframe.contentWindow as any).thesara = {
      storage: storageClient,
      appId,
      authToken: token,
    };
  };

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!appId) {
        setError('Missing app id.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setErrorCode(null);
      setBuildId(null);
      setState(null);
      setAppUrl(null);
      setIframeHtml(null);
      setFallbackAppUrl(null);
      setNetworkPolicy(undefined);
      setNetworkDomains([]);

      try {
        const listing = await apiFetch<ListingResponse>(`/listing/${encodeURIComponent(appId)}`);
        const latestBuildId = listing?.item?.buildId || null;
        if (!latestBuildId) {
          if (!cancelled) {
            setBuildId(null);
            setError('Build not found.');
          }
          setLoading(false);
          return;
        }
        if (cancelled) return;

        setBuildId(latestBuildId);
        const safeId = encodeURIComponent(latestBuildId);

        try {
          const status = await apiFetch<BuildStatusResponse>(`/build/${safeId}/status`, { auth: true });
          if (cancelled) return;
          setState(status?.state ?? null);
          const policy = status?.artifacts?.networkPolicy;
          if (policy) {
            setNetworkPolicy(policy);
          }
        } catch (err) {
          if (cancelled) return;
          if (err instanceof ApiError) {
            setErrorCode(err.code || String(err.status));
          }
        }

        // Best-effort fetch of manifest to list reported network domains
        try {
          const manifestUrl = joinUrl(API_URL, `/builds/${safeId}/build/manifest_v1.json`);
          const res = await fetch(manifestUrl, { cache: 'no-store', credentials: 'include' });
          if (!cancelled && res.ok) {
            const data = await res.json();
            if (Array.isArray(data?.networkDomains)) {
              setNetworkDomains(data.networkDomains.map((d: unknown) => String(d)).slice(0, 10));
            }
          }
        } catch {
          // ignore manifest failures
        }

        if (cancelled) return;
        // Construct the direct path to the build's root to avoid server-side redirects.
        // The static server will automatically serve index.html from this directory.
        const qp = token ? `?token=${encodeURIComponent(token)}` : '';
        const bundleUrl = `/builds/${safeId}/bundle/index.html${qp}`;
        const legacyUrl = `/builds/${safeId}/build/index.html${qp}`;
        setAppUrl(bundleUrl);
        setFallbackAppUrl(legacyUrl);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setError(err.message || 'Failed to load app.');
          setErrorCode(err.code || String(err.status));
        } else {
          setError('Failed to load app.');
        }
        setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [appId, token]);

  // Effect to fetch HTML when appUrl is ready
  useEffect(() => {
    if (!appUrl) {
      // This can happen on first load before the initial effect sets the URL
      if (!loading && !error) {
        setError('Could not determine app URL.');
      }
      return;
    }

    let cancelled = false;

    async function fetchHtml() {
      try {
        const fetchWithNoStore = (url: string) => fetch(url, { cache: 'no-store' });

        let response = await fetchWithNoStore(appUrl);
        if (cancelled) return;
        let attemptedCacheBypass = false;

        while (response.status === 304 && !attemptedCacheBypass) {
          attemptedCacheBypass = true;
          const retryUrl = new URL(appUrl, window.location.origin);
          retryUrl.searchParams.set('_cb', Date.now().toString());
          response = await fetchWithNoStore(retryUrl.toString());
          if (cancelled) return;
        }
        if (cancelled) return;

        if (!response.ok) {
          throw new Error(`Failed to load app content, status: ${response.status}`);
        }

        const htmlContent = await response.text();
        if (cancelled) return;

        // After redirects, the final URL is what we need for the <base> tag
        const finalUrl = new URL(response.url);
        // The base path must be a directory, so it must end with a '/'
        const pathname = finalUrl.pathname;
        const basePath = pathname.substring(0, pathname.lastIndexOf('/') + 1);

        const parser = new DOMParser();
        const parsedDocument = parser.parseFromString(htmlContent, 'text/html');
        const head = parsedDocument.querySelector('head');
        if (!head) {
          throw new Error('App HTML is missing a <head> element.');
        }

        const baseElement = head.querySelector('base') ?? parsedDocument.createElement('base');
        baseElement.setAttribute('href', basePath);
        if (!baseElement.parentElement) {
          head.insertBefore(baseElement, head.firstChild);
        }

        const importMapScripts = Array.from(
          parsedDocument.querySelectorAll<HTMLScriptElement>('script[type="importmap"]'),
        );

        const additionalImports: Record<string, string> = {
          react: 'https://esm.sh/react@18',
          'react/jsx-dev-runtime': 'https://esm.sh/react@18/jsx-dev-runtime',
          'react-dom': 'https://esm.sh/react-dom@18',
          'react-dom/client': 'https://esm.sh/react-dom@18/client',
          'framer-motion': 'https://esm.sh/framer-motion@10',
          'html-to-image': 'https://esm.sh/html-to-image@1.11.11',
          recharts: 'https://esm.sh/recharts@2',
        };

        let extendedExistingMap = false;
        for (const script of importMapScripts) {
          const content = script.textContent?.trim();
          if (!content) continue;
          try {
            const parsed = JSON.parse(content);
            if (!parsed || typeof parsed !== 'object') continue;
            const imports = (parsed.imports ?? {}) as Record<string, string>;
            parsed.imports = { ...imports, ...additionalImports };
            script.textContent = `${JSON.stringify(parsed, null, 2)}\n`;
            extendedExistingMap = true;
            break;
          } catch {
            // Ignore JSON parse errors and continue to next import map
          }
        }

        if (!extendedExistingMap) {
          const script = parsedDocument.createElement('script');
          script.setAttribute('type', 'importmap');
          script.textContent = `${JSON.stringify({ imports: additionalImports }, null, 2)}\n`;
          head.insertBefore(script, baseElement.nextSibling);
        }

        const serializedHtml = parsedDocument.documentElement?.outerHTML ?? htmlContent;
        const hasDoctype = /^<!doctype/i.test(htmlContent);
        const finalHtml = `${hasDoctype ? '<!DOCTYPE html>\n' : ''}${serializedHtml}`;

        if (cancelled) return;

        setIframeHtml(finalHtml);
        setLoading(false);
      } catch (err: any) {
        if (cancelled) return;
        if (fallbackAppUrl && appUrl !== fallbackAppUrl) {
          setLoading(true);
          setAppUrl(fallbackAppUrl);
          return;
        }
        setError(err.message || 'Failed to fetch app HTML.');
        setLoading(false);
      }
    }

    fetchHtml();

    return () => {
      cancelled = true;
    };
  }, [appUrl, fallbackAppUrl]);

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Loading app...</h1>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Unable to load app</h1>
        <p>{error}</p>
        {errorCode && (
          <p>
            <strong>Code:</strong> {errorCode}
          </p>
        )}
      </div>
    );
  }

  if (!iframeHtml) {
    if (state && state !== 'published') {
      return (
        <div style={{ padding: 24 }}>
          <h1>Build {buildId} in state {state}</h1>
        </div>
      );
    }
    // Don't show "Build not found" while HTML is loading
    if (!loading) {
      return (
        <div style={{ padding: 24 }}>
          <h1>Build not found</h1>
        </div>
      );
    }
    // Otherwise, the main loading indicator is already showing
    return null;
  }

  const needsConsent =
    typeof networkPolicy === 'string' && networkPolicy.toUpperCase() === 'OPEN_NET' && !run;

  if (needsConsent) {
    return (
      <div style={{ padding: 24, maxWidth: 720 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>Launch application</h1>
        <p className="text-sm" style={{ marginBottom: 8 }}>
          This app requests Open Net access.
          {networkDomains.length > 0 && ' Reported domains:'}
        </p>
        {networkDomains.length > 0 && (
          <ul style={{ marginBottom: 12, paddingLeft: 18, listStyle: 'disc' }}>
            {networkDomains.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
        <div style={{ display: 'flex', gap: 12 }}>
          <Link href={`?run=1${token ? `&token=${encodeURIComponent(token)}` : ''}`} className="px-3 py-2 bg-emerald-600 text-white rounded">
            Launch app
          </Link>
          <Link href="/apps" className="px-3 py-2 border rounded">
            Cancel
          </Link>
        </div>
        <p className="text-xs" style={{ marginTop: 12, color: '#475569' }}>
          Apps run inside a sandboxed iframe with a strict CSP.
        </p>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      srcDoc={iframeHtml}
      onLoad={handleIframeLoad}
      style={{ border: 'none', width: '100%', height: '100vh' }}
      sandbox={IFRAME_SANDBOX}
    />
  );
}