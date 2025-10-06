// Ne koristi 'use client' – ovo može i na serveru i na klijentu (NEXT_PUBLIC_* bude inlinan).
const pv = (v?: string) => (v ? `${v.slice(0, 4)}…${v.slice(-4)}` : 'undefined');

export function checkFirebaseEnv() {
  const cfg = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  };

  const missing = Object.entries(cfg)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  // Sigurniji kratki log (samo dev) – ne ispisuj pune vrijednosti
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.log('[firebaseEnv] ',
      Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, pv(v || undefined)]))
    );
  }

  return { cfg, missing };
}
