'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useSafeSearchParams } from './useSafeSearchParams';

type FallbackResolver = (segments: string[]) => string | null | undefined;

export function useRouteSegments(): string[] {
  const pathname = usePathname() ?? '';
  return useMemo(() => pathname.split('/').filter(Boolean), [pathname]);
}

export function useRouteParam(name: string, fallback?: FallbackResolver): string {
  const searchParams = useSafeSearchParams();
  const segments = useRouteSegments();

  return useMemo(() => {
    const fromQuery = searchParams.get(name);
    if (fromQuery) {
      return fromQuery;
    }
    if (fallback) {
      const resolved = fallback(segments);
      if (resolved) {
        return resolved;
      }
    }
    return '';
  }, [fallback, name, searchParams, segments]);
}

