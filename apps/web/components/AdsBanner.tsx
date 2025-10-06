'use client';

import { useAuth } from '@/lib/auth';
import { useEffect, useState } from 'react';
import { hasEntitlement } from '@/lib/entitlements';
import { apiGet } from '@/lib/api';

interface Ad {
  id: string;
  slug: string;
  title: string;
}

export default function AdsBanner() {
  const { user } = useAuth();
  const [ad, setAd] = useState<Ad | null>(null);

  useEffect(() => {
    async function load() {
      let show = true;
      if (user?.uid) {
        try {
          show = !(await hasEntitlement(user.uid, ['noAds', 'isGold']));
        } catch {}
      }
      if (show) {
        try {
          const json = await apiGet<{ items?: Ad[] }>(`/listings`);
          setAd(json.items?.[0] || null);
        } catch {
          setAd(null);
        }
      }
    }
    load();
  }, [user]);

  if (!ad) return null;

  return (
    <a href={`/app?slug=${encodeURIComponent(ad.slug)}`} className="block p-4 bg-gray-100 text-center text-gray-900">
      {ad.title}
    </a>
  );
}

