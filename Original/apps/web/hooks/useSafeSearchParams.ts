'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ReadonlyURLSearchParams } from 'next/navigation';

const EMPTY_SEARCH_PARAMS: ReadonlyURLSearchParams = new URLSearchParams() as unknown as ReadonlyURLSearchParams;

export function useSafeSearchParams(): ReadonlyURLSearchParams {
  const params = useSearchParams();

  return useMemo(
    () => params ?? EMPTY_SEARCH_PARAMS,
    [params],
  );
}
