'use client';

import { useEffect, useState } from 'react';

interface Result {
  errors: string[];
  warnings: string[];
}

export default function DoctorBanner() {
  const [res, setRes] = useState<Result | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const base = process.env.NEXT_PUBLIC_API_URL || '';
    fetch(`${base}/doctor`)
      .then((r) => r.json())
      .then(setRes)
      .catch(() => setRes(null));
  }, []);

  if (!res || (res.errors.length === 0 && res.warnings.length === 0)) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-yellow-100 text-yellow-900 p-2 text-sm">
      {res.errors.length > 0 && (
        <div>
          <strong>Errors:</strong>
          <ul className="list-disc list-inside">
            {res.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {res.warnings.length > 0 && (
        <div className="mt-2">
          <strong>Warnings:</strong>
          <ul className="list-disc list-inside">
            {res.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

