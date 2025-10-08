'use client';

import { usePathname } from 'next/navigation';
import SiteHeader from './SiteHeader';

export default function OptionalSiteHeader() {
  const pathname = usePathname() ?? '';
  // Hide simple site header on homepage to keep the rich Header there
  if (pathname === '/') return null;
  return <SiteHeader />;
}
