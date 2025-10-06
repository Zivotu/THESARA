const pv = (v?: string) => (v ? `${v.slice(0,4)}…${v.slice(-4)}` : '(missing)');
export default function Page() {
  const cfg = {
    apiKey: pv(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
    authDomain: pv(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
    projectId: pv(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
    appId: pv(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
    storageBucket: pv(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: pv(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
  };
  const missing = Object.entries(cfg).filter(([,v]) => v === '(missing)').map(([k]) => k);
  return (
    <div style={{padding:20}}>
      <h1>{missing.length ? 'Firebase NOT configured' : 'Firebase configured ✅'}</h1>
      {missing.length ? <p>Missing: <b>{missing.join(', ')}</b></p> : null}
      <pre>{JSON.stringify(cfg, null, 2)}</pre>
    </div>
  );
}
