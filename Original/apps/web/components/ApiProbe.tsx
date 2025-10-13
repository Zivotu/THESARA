'use client';

import { useEffect } from 'react';
import { checkApiUrlReachability } from '@/lib/config';

export default function ApiProbe() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
      void checkApiUrlReachability();
    }
  }, []);

  return null;
}
