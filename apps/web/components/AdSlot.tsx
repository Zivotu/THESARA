'use client';

import { useEntitlements } from '@/hooks/useEntitlements';
import React from 'react';

export default function AdSlot({ className = '' }: { className?: string }) {
  const { data } = useEntitlements();
  if (data?.noAds) return null;
  return (
    <div className={`w-full bg-gray-200 text-gray-600 text-sm flex items-center justify-center ${className}`}>
      Ad — 320×100
    </div>
  );
}
