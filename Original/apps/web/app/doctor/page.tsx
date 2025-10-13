'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_URL } from '@/lib/config';

interface Result {
  errors: string[];
  warnings: string[];
}

export default function DoctorPage() {
  const [res, setRes] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_URL}/doctor`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((data) => setRes(data))
      .catch((e) => {
        setError(e.message || 'Failed to fetch');
        setRes(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch(`${API_URL}/health`, { method: 'HEAD', cache: 'no-store' })
      .then((r) => setHealthOk(r.ok))
      .catch(() => setHealthOk(false));
  }, []);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">
        Doctor
        {healthOk !== null && (
          <span
            className={`ml-2 px-2 py-1 rounded text-sm ${
              healthOk ? 'bg-emerald-200 text-emerald-800' : 'bg-yellow-200 text-yellow-800'
            }`}
          >
            {healthOk ? 'OK' : 'WARN'}
          </span>
        )}
      </h1>
      {loading && <p>Checking...</p>}
      {error && (
        <div className="mb-4 p-4 rounded-lg bg-red-50 text-red-700">
          <p className="mb-2">{error}</p>
          <button
            onClick={load}
            className="mt-2 px-4 py-2 rounded bg-emerald-500 text-white hover:bg-emerald-600"
          >
            Retry
          </button>
        </div>
      )}
      {!loading && res && (
        <div>
          {res.errors.length > 0 && (
            <div className="mb-4">
              <strong>Errors:</strong>
              <ul className="list-disc list-inside">
                {res.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {res.warnings.length > 0 && (
            <div className="mb-4">
              <strong>Warnings:</strong>
              <ul className="list-disc list-inside">
                {res.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {res.errors.length === 0 && res.warnings.length === 0 && (
            <p>No issues found.</p>
          )}
          <button
            onClick={load}
            className="mt-4 px-4 py-2 rounded bg-emerald-500 text-white hover:bg-emerald-600"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

