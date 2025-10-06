'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';

export default function AuthLinks() {
  const { user } = useAuth();
  if (user) {
    return (
      <Link href="/profile" className="hover:underline" title="My profile">
        Profile
      </Link>
    );
  }
  return (
    <Link href="/login" className="hover:underline" title="Log in">
      Login
    </Link>
  );
}
