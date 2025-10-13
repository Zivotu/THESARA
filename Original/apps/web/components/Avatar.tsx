'use client';
import Image from 'next/image';
import { API_URL } from '@/lib/config';
import { useState } from 'react';

type Props = {
  uid?: string;
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
};

export default function Avatar({ uid, src, name = '', size = 32, className = '' }: Props) {
  const [err, setErr] = useState(false);
  const validSrc = typeof src === 'string' && src.trim().length > 0;
  let finalSrc = validSrc ? src!.trim() : '';
  if (finalSrc && !/^https?:\/\//.test(finalSrc)) {
    finalSrc = '';
  }
  if (finalSrc && finalSrc.includes('googleusercontent')) {
    try {
      const u = new URL(finalSrc);
      u.searchParams.set('sz', String(size));
      finalSrc = u.toString();
    } catch {}
  }
  if (err || !finalSrc) {
    return (
      <Image
        src="/default-avatar.svg"
        alt={name || 'avatar'}
        width={size}
        height={size}
        style={{ color: 'transparent' }}
        className={`rounded-full ${className}`}
        title="Default avatar"
      />
    );
  }

  const apiUrl = `${API_URL}/avatar/${uid ?? '0'}?url=${encodeURIComponent(finalSrc)}`;

  return (
    <Image
      src={apiUrl}
      alt={name || 'avatar'}
      width={size}
      height={size}
      style={{ color: 'transparent' }}
      className={`rounded-full ${className}`}
      onError={() => setErr(true)}
    />
  );
}
