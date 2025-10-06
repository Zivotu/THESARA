import { Suspense } from 'react';
import type { Listing as ApiListing } from '@/lib/types';
import HomeClient from './HomeClient';
import { getListings } from '@/lib/loaders';
import { defaultLocale } from '@/i18n/config';

function HomeFallback() {
  return (
    <div className="mx-auto max-w-7xl px-4 pb-16">
      <div className="mb-12 mt-10">
        <div className="h-10 w-2/3 rounded-full bg-gray-100" />
        <div className="mt-4 h-4 w-1/2 rounded-full bg-gray-100" />
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, idx) => (
          <div key={idx} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="aspect-video bg-gray-100" />
            <div className="space-y-3 p-4">
              <div className="h-6 w-3/4 rounded bg-gray-100" />
              <div className="h-4 w-full rounded bg-gray-100" />
              <div className="flex gap-3">
                <div className="h-4 w-16 rounded bg-gray-100" />
                <div className="h-4 w-16 rounded bg-gray-100" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function Page() {
  const locale = defaultLocale;
  let initialItems: ApiListing[] = [];
  try {
    const { items } = await getListings({ locale });
    initialItems = items;
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[Home] Failed to prefetch listings', error);
    }
  }

  return (
    <Suspense fallback={<HomeFallback />}>
      <HomeClient initialItems={initialItems} />
    </Suspense>
  );
}

