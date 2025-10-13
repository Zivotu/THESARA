'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getMissingFirebaseEnv } from '@/lib/env';

export default function FirebaseRedirect({ children }: { children?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (pathname.startsWith('/dev')) {
      return;
    }
    const missing = getMissingFirebaseEnv();
    if (missing.length > 0 && pathname !== '/setup') {
      router.replace('/setup');
    }
  }, [pathname, router]);

  if (process.env.NODE_ENV !== 'production') return children as any;
  return <>{children}</>;
}
