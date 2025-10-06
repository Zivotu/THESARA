'use client';

const pv = (value?: string) => (value ? `${value.slice(0, 4)}...${value.slice(-4)}` : '(missing)');

export default function FirebaseCheckPage() {
  const cfg = {
    apiKey: pv(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
    authDomain: pv(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
    projectId: pv(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
    appId: pv(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
    storageBucket: pv(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: pv(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
  };
  const missing = Object.entries(cfg)
    .filter(([, value]) => value === '(missing)')
    .map(([key]) => key);

  return (
    <div style={{ padding: 20 }}>
      <h1>{missing.length ? 'Firebase NOT configured' : 'Firebase configured OK'}</h1>
      {missing.length ? <p>Missing: {missing.join(', ')}</p> : null}
      <pre>{JSON.stringify(cfg, null, 2)}</pre>
    </div>
  );
}


