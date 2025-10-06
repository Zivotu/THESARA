'use client';
import { useEffect, useState } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
export default function WebPing() {
  const [msg, setMsg] = useState('Running…');
  useEffect(() => {
    (async () => {
      try {
        const cfg = {
          apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
          authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
          appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
          storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
          messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
        };
        const app = getApps()[0] ?? initializeApp(cfg);
        await signInAnonymously(getAuth(app));
        const db = getFirestore(app);
        const ref = doc(db, 'debug', 'web-ping');
        await setDoc(ref, { ok: true, at: new Date().toISOString() }, { merge: true });
        const snap = await getDoc(ref);
        setMsg('Web SDK OK: ' + JSON.stringify(snap.data()));
      } catch (e: any) {
        setMsg('Web SDK FAILED: ' + (e?.message || String(e)));
      }
    })();
  }, []);
  return <pre style={{ padding: 20 }}>{msg}</pre>;
}
