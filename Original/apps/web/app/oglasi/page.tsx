'use client';

import { Suspense } from 'react';
import { useRouteParam } from '@/hooks/useRouteParam';
import OglasDetaljiClient from './ClientOglasDetalji';

export default function OglasDetaljiPage() {
  return (
    <Suspense fallback={null}>
      <OglasPageClient />
    </Suspense>
  );
}

function OglasPageClient() {
  const id = useRouteParam('id', (segments) => {
    if (segments.length > 1 && segments[0] === 'oglasi') {
      return segments[1] ?? '';
    }
    return undefined;
  });

  return <OglasDetaljiClient id={id} />;
}

