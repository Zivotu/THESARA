'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Logo from '@/components/Logo';
import AuthLinks from '@/components/AuthLinks';

export default function SiteHeader() {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-40 backdrop-blur-lg supports-[backdrop-filter]:bg-white/75 border-b border-gray-200/50 shadow-sm">
      <div className="flex items-center justify-between max-w-7xl mx-auto p-4">
        <Logo />
        <nav className="flex items-center gap-4 text-sm">
          <button
            type="button"
            onClick={() => router.back()}
            className="text-gray-600 hover:underline"
          >
            Back
          </button>
          <Link href="/faq" className="text-gray-600 hover:underline">
            FAQ
          </Link>
          <AuthLinks />
        </nav>
      </div>
    </header>
  );
}

