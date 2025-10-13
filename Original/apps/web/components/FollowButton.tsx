'use client';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { doc, setDoc, getDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

export default function FollowButton({ creatorId, handle }: { creatorId: string; handle: string }) {
  const { user } = useAuth();
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);

  // On mount, detect if already favorited (Firestore first, then localStorage)
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (user && db) {
          const favSnap = await getDoc(doc(db, 'users', user.uid, 'favorites', creatorId));
          if (!cancelled && favSnap.exists()) {
            setDone(true);
            return;
          }
        }
      } catch {}
      try {
        const raw = localStorage.getItem('cx:favorites');
        const map = raw ? (JSON.parse(raw) as Record<string, { handle?: string }>) : {};
        if (!cancelled && map[creatorId]) setDone(true);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [user, creatorId]);

  const onClick = async () => {
    if (!user) return;
    try {
      setBusy(true);
      if (!done) {
        // Add favorite
        if (db) await setDoc(
          doc(db, 'users', user.uid, 'favorites', creatorId),
          {
            creatorId,
            handle: handle || null,
            addedAt: serverTimestamp(),
          },
          { merge: true }
        );
        setDone(true);
      } else {
        // Remove favorite
        if (db) await deleteDoc(doc(db, 'users', user.uid, 'favorites', creatorId));
        setDone(false);
      }
    } catch (e) {
      console.error('Favorite toggle failed (Firestore). Falling back to localStorage.', e);
      try {
        const key = 'cx:favorites';
        const raw = localStorage.getItem(key);
        const map = raw ? (JSON.parse(raw) as Record<string, { handle?: string }>) : {};
        if (!done) {
          map[creatorId] = { handle };
          localStorage.setItem(key, JSON.stringify(map));
          setDone(true);
        } else {
          delete map[creatorId];
          localStorage.setItem(key, JSON.stringify(map));
          setDone(false);
        }
      } catch (err) {
        console.error('LocalStorage fallback failed', err);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <Link href="/login" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
        </svg>
        <span>Dodaj u favorite</span>
      </Link>
    );
  }

  return (
    <button
      onClick={onClick}
      disabled={busy || done}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border ${done ? 'border-red-300 text-red-700 hover:bg-red-50' : 'border-gray-300 hover:bg-gray-50'}`}
      title={done ? 'Ukloni iz favorita' : 'Dodaj u favorite'}
    >
      <svg className={`w-5 h-5 ${done ? 'text-red-500' : ''}`} fill={done ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
      </svg>
      <span>{done ? 'Ukloni iz favorita' : 'Dodaj u favorite'}</span>
    </button>
  );
}
