'use client';

import ClientPlayPage from './ClientPlayPage';
import { Suspense } from 'react';
import { useRouteParam } from '@/hooks/useRouteParam';

export default function PlayPage() {
  return (
    <Suspense fallback={null}>
      <PlayPageClient />
    </Suspense>
  );
}

function PlayPageClient() {
  const appId = useRouteParam('appId', (segments) => {
    if (segments.length > 1 && segments[0] === 'play') {
      return segments[1] ?? '';
    }
    return undefined;
  });
  return <ClientPlayPage appId={appId} />;
}

