'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouteParam } from '@/hooks/useRouteParam';
import CreatorAllAccessCard from '@/components/CreatorAllAccessCard';
import Avatar from '@/components/Avatar';
import AppCard, { type Listing } from '@/components/AppCard';
import FollowButton from '@/components/FollowButton';
import { API_URL } from '@/lib/config';
import { apiFetch, ApiError } from '@/lib/api';

type AppInfo = Listing;

type CreatorInfo = {
  id: string;
  allAccessPrice?: number;
  displayName?: string;
  photoURL?: string;
};

interface PageState {
  loading: boolean;
  apps: AppInfo[];
  creator: CreatorInfo | null;
  error: string | null;
  notFound: boolean;
}

function normalizePhoto(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return `${API_URL}${trimmed}`;
  return `${API_URL}/${trimmed}`;
}

export default function CreatorProfilePage() {
  return (
    <Suspense fallback={null}>
      <CreatorProfileClient />
    </Suspense>
  );
}

function CreatorProfileClient() {
  const handle = useRouteParam('handle', (segments) => {
    if (segments.length > 1 && segments[0] === 'u') {
      return segments[1] ?? '';
    }
    return undefined;
  });
  const [state, setState] = useState<PageState>({
    loading: true,
    apps: [],
    creator: null,
    error: null,
    notFound: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!handle) {
        setState({ loading: false, apps: [], creator: null, error: 'Missing handle.', notFound: true });
        return;
      }

      setState((prev) => ({ ...prev, loading: true, error: null, notFound: false }));

      let apps: AppInfo[] = [];
      let creator: CreatorInfo | null = null;
      let error: string | null = null;
      let notFound = false;

      try {
        const data = await apiFetch<{ items?: AppInfo[]; apps?: AppInfo[] }>(`/creators/${encodeURIComponent(handle)}/apps`);
        apps = (data?.items || data?.apps || []).map((item) => ({ ...item }));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          notFound = true;
        } else {
          error = err instanceof Error ? err.message : 'Failed to load apps.';
        }
      }

      try {
        const data = await apiFetch<any>(`/creators/${encodeURIComponent(handle)}`);
        if (data) {
          creator = {
            id: data.id,
            allAccessPrice: data.allAccessPrice,
            displayName: data.displayName,
            photoURL:
              normalizePhoto(
                data.photoURL ?? data.photoUrl ?? data.photo ?? data.avatarUrl ?? data.avatar,
              ) || undefined,
          };
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          notFound = true;
        } else {
          error = error || (err instanceof Error ? err.message : 'Failed to load creator.');
        }
      }

      if (!cancelled) {
        setState({
          loading: false,
          apps,
          creator,
          error,
          notFound: notFound && !creator && apps.length === 0,
        });
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [handle]);

  const effectivePhoto = useMemo(() => {
    if (!state.creator?.photoURL && state.apps.length > 0) {
      const fallback = state.apps.find((app: any) => app?.author?.photo);
      if (fallback?.author?.photo) {
        return String(fallback.author.photo);
      }
    }
    return state.creator?.photoURL;
  }, [state.creator?.photoURL, state.apps]);

  if (state.loading) {
    return (
      <main className="max-w-7xl mx-auto p-4 md:p-6">
        <p className="text-gray-500">Loading creator...</p>
      </main>
    );
  }

  if (state.error) {
    return (
      <main className="max-w-7xl mx-auto p-4 md:p-6">
        <p className="text-red-600">{state.error}</p>
      </main>
    );
  }

  if (state.notFound) {
    return (
      <main className="max-w-7xl mx-auto p-4 md:p-6">
        <p className="text-gray-500">Creator not found.</p>
      </main>
    );
  }

  const creator = state.creator;
  const apps = state.apps;
  const showAllAccess = typeof creator?.allAccessPrice === 'number' && (creator.allAccessPrice || 0) > 0;

  return (
    <main className="max-w-7xl mx-auto p-4 md:p-6">
      <div className="flex items-center gap-4 mb-4">
        <Avatar
          uid={creator?.id || handle || 'unknown'}
          src={effectivePhoto}
          name={creator?.displayName || (handle ? `@${handle}` : 'Creator')}
          size={64}
          className="w-16 h-16 ring-1 ring-gray-200"
        />
        <div>
          <h1 className="text-2xl font-bold">@{handle}</h1>
          {creator?.displayName && <p className="text-gray-600">{creator.displayName}</p>}
        </div>
        {creator?.id && (
          <div>
            <FollowButton creatorId={creator.id} handle={handle || ''} />
          </div>
        )}
      </div>
      {showAllAccess && creator?.id && creator.allAccessPrice && (
        <CreatorAllAccessCard creatorUid={creator.id} price={creator.allAccessPrice} />
      )}
      <h2 className="text-xl font-semibold mt-6 mb-2">Aplikacije</h2>
      {apps.length === 0 ? (
        <p className="text-gray-500">Kreator nema javnih aplikacija.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {apps.map((app) => (
            <AppCard key={app.id} item={app} viewMode="grid" />
          ))}
        </div>
      )}
    </main>
  );
}
