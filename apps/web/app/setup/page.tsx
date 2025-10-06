import { REQUIRED_FIREBASE_KEYS, getMissingFirebaseEnv } from '@/lib/env';

export default function SetupPage() {
  const missing = getMissingFirebaseEnv();
  return (
    <main className="max-w-xl mx-auto p-4 space-y-4">
      <h1 className="text-xl font-bold">Firebase not configured</h1>
      {missing.length > 0 && (
        <>
          <p>The following environment variables are missing:</p>
          <ul className="list-disc list-inside">
            {missing.map((k) => (
              <li key={k}>
                <code>{k}</code>
              </li>
            ))}
          </ul>
        </>
      )}
      <p>Add them to your <code>.env.local</code> file:</p>
      <pre className="bg-gray-100 p-2 rounded text-sm">
        {REQUIRED_FIREBASE_KEYS.map((k) => `${k}=\n`).join('')}
      </pre>
    </main>
  );
}
