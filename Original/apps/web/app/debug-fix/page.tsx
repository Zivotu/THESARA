'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { apiGet } from '@/lib/api';

export default function DebugFixPage() {
  const { user } = useAuth();
  const [message, setMessage] = useState('');

  async function handleFix() {
    setMessage('Pokušavam popraviti...');
    try {
      const res = await apiGet<{ url?: string; message?: string }>('/debug/fix-onboarding', { auth: true });
      if (res.url) {
        setMessage('Preusmjeravam na Stripe...');
        window.location.assign(res.url);
      } else {
        setMessage(res.message || 'Nije pronađen URL. Pokušajte ponovno postaviti cijenu.');
      }
    } catch (err: any) {
      setMessage(`Došlo je do greške: ${err.message}`);
    }
  }

  if (!user) {
    return <p>Molimo prijavite se...</p>;
  }

  return (
    <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#333' }}>
      <h1 style={{ fontSize: 24, marginBottom: 20 }}>Popravak Stripe Sinkronizacije</h1>
      <p style={{ marginBottom: 20 }}>
        Pritisnite gumb ispod kako biste ponovno pokrenuli proces povezivanja sa Stripeom. <br />
        Ovo bi trebalo riješiti problem s postavljanjem cijene.
      </p>
      <button
        onClick={handleFix}
        style={{
          padding: '10px 20px',
          fontSize: 16,
          background: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: 5,
          cursor: 'pointer'
        }}
      >
        Popravi Stripe Sinkronizaciju
      </button>
      {message && <p style={{ marginTop: 20, color: '#555' }}>{message}</p>}
    </div>
  );
}
