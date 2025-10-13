"use client";

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';

export default function WhoAmI() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const json = await apiGet('/_debug/whoami', { auth: true });
        setData(json);
      } catch (e: any) {
        setError(e?.message || 'Error');
      }
    })();
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h1>Who Am I</h1>
      {error ? (
        <div style={{ color: 'red' }}>{error}</div>
      ) : (
        <pre>{JSON.stringify(data, null, 2)}</pre>
      )}
      <p>Note: you must be signed in for this to work.</p>
    </div>
  );
}

