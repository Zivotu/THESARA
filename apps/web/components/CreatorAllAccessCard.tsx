'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/lib/config';
import { useAuth } from '@/lib/auth';

interface Props {
  creatorUid: string;
  price: number;
}

export default function CreatorAllAccessCard({ creatorUid, price }: Props) {
  const { user } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const isCreator = user?.uid === creatorUid;

  async function subscribe() {
    setBusy(true);
    setError(null);
    try {
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = crypto.randomUUID();
      }
      const token = await (user as any)?.getIdToken?.();
      if (!token) {
        router.push('/login');
        return;
      }
      const res = await fetch(`${API_URL}/billing/subscriptions/creator`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          creatorId: creatorUid,
          // Stripe Checkout will collect customer data; key kept for retry safety if server supports it later
          idempotencyKey: idempotencyKeyRef.current,
        }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('bad_response');
      const json = await res.json();
      if (json?.url) {
        window.location.href = json.url as string;
        return;
      }
      setError('Neispravan odgovor poslužitelja');
    } catch {
      setError('Greška pri komunikaciji s API-jem');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white border rounded-xl shadow-md p-6 text-center mt-4">
      <h2 className="text-2xl font-bold mb-2">Creator All-Access</h2>
      <div className="text-3xl font-bold mb-1">
        ${price}
        <span className="text-base font-normal">/mo</span>
      </div>
      <p className="text-gray-600 mb-4">Unlock all apps from this creator.</p>
      {error && <p className="text-red-500 mb-2">{error}</p>}
      {isCreator ? (
        <p className="text-gray-600">You already have access to all your apps.</p>
      ) : (
        <button
          onClick={subscribe}
          disabled={busy}
          className="inline-block bg-emerald-600 text-white px-5 py-2 rounded-lg font-medium hover:bg-emerald-700 transition"
        >
          {busy ? 'Processing…' : 'Unlock Creator'}
        </button>
      )}
    </section>
  );
}
