'use client';

import { useEffect, useState } from 'react';

export type RelativeFormatter = (timestamp: number) => string;

/**
 * Returns a relative time string that is calculated on the client after hydration.
 * The initial value is empty so that server and client markup stay in sync.
 */
export function useRelativeTime(
  timestamp?: number | null,
  formatter?: RelativeFormatter,
  refreshMs = 60_000
): string {
  const format = formatter ?? defaultFormatter;
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!timestamp) {
      setValue('');
      return;
    }

    const run = () => setValue(format(timestamp));
    run();

    if (refreshMs <= 0) return;
    const id = window.setInterval(run, refreshMs);
    return () => clearInterval(id);
  }, [timestamp, format, refreshMs]);

  return value;
}

const defaultFormatter: RelativeFormatter = (ts: number) => {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
};
