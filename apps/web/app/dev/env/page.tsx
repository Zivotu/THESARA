'use client';

const mask = (v?: string) => (v ? `${v.slice(0,4)}…${v.slice(-4)}` : '(missing)');

export default function EnvTest() {
  const env = {
    apiKey: mask(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
    authDomain: mask(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
    projectId: mask(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
    appId: mask(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
    storageBucket: mask(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: mask(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
    runtime: typeof window === 'undefined' ? 'server' : 'client',
  };
  return (
    <div style={{ padding: 20 }}>
      <h1>Firebase ENV Check</h1>
      <pre>{JSON.stringify(env, null, 2)}</pre>
    </div>
  );
}
