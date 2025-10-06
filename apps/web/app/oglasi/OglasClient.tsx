'use client';

import Head from 'next/head';
import { useCallback, useEffect, useState } from 'react';
import { API_URL } from '@/lib/config';
import { useAuth } from '@/lib/auth';

interface Recenzija {
  korisnik: string;
  ocjena: number;
  komentar: string;
  datum: string;
}

interface Props {
  id: string;
}

export default function OglasClient({ id }: Props) {
  const { user } = useAuth();
  const [recenzije, setRecenzije] = useState<Recenzija[]>([]);
  const [prosjek, setProsjek] = useState(0);
  const [canReview, setCanReview] = useState(false);
  const [ocjena, setOcjena] = useState(5);
  const [komentar, setKomentar] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const token = user ? await user.getIdToken() : undefined;
      const res = await fetch(`${API_URL}/recenzije/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const data = await res.json();
      setRecenzije(data.recenzije || []);
      setProsjek(data.prosjek || 0);
      setCanReview(Boolean(data.canReview));
    } catch (err) {
      console.error('Failed to load recenzije', err);
    }
  }, [id, user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitRecenzija(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    try {
      const token = user ? await user.getIdToken() : undefined;
      await fetch(`${API_URL}/recenzije`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ oglas: Number(id), ocjena, komentar }),
      });
      setKomentar('');
      setOcjena(5);
      void load();
    } catch (err) {
      console.error('Failed to submit recenzija', err);
    }
  }

  return (
    <div className="max-w-xl mx-auto p-4">
      <Head>
        <title>{`Oglas ${id}`}</title>
        <meta
          name="description"
          content={`Detalji oglasa ${id} i recenzije korisnika`}
        />
      </Head>
      <h1 className="text-2xl font-bold mb-2">Oglas {id}</h1>
      <p className="mb-4">Prosječna ocjena: {prosjek.toFixed(1)}</p>
      <ul className="space-y-2 mb-4">
        {recenzije.map((r, i) => (
          <li key={i} className="border p-2 rounded">
            <div className="font-semibold">Ocjena: {r.ocjena}</div>
            <div className="text-sm">{r.komentar}</div>
          </li>
        ))}
      </ul>
      {canReview && (
        <form onSubmit={submitRecenzija} className="space-y-2">
          <select
            value={ocjena}
            onChange={(e) => setOcjena(Number(e.target.value))}
            className="border p-2 rounded"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <textarea
            value={komentar}
            onChange={(e) => setKomentar(e.target.value)}
            placeholder="Komentar"
            className="w-full border p-2 rounded"
          />
          <button
            type="submit"
            className="bg-blue-500 text-white px-4 py-2 rounded"
          >
            Pošalji recenziju
          </button>
        </form>
      )}
    </div>
  );
}
