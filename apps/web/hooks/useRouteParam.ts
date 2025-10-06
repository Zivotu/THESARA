'use client';

import { useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

type FallbackResolver = (segments: string[]) => string | null | undefined;

export function useRouteSegments(): string[] {
  const pathname = usePathname();
  return useMemo(() => pathname.split('/').filter(Boolean), [pathname]);
}

export function useRouteParam(name: string, fallback?: FallbackResolver): string {
  const searchParams = useSearchParams();
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

