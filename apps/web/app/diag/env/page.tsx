import { readPublicEnv, getMissingFirebaseEnv } from '@/lib/env';

function mask(value?: string) {
  if (!value) return value;
  return value.length <= 8
    ? value
    : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export default function EnvPage() {
  const env = readPublicEnv();
  const missing = getMissingFirebaseEnv();

  const maskedEnv = Object.fromEntries(
    Object.entries(env).map(([k, v]) => [k, mask(v)]),
  );

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Env diagnostics</h1>
      <pre className="bg-gray-100 p-4 rounded text-sm">
        {JSON.stringify(maskedEnv, null, 2)}
      </pre>
      <h2 className="mt-4 font-semibold">Missing keys</h2>
      {missing.length === 0 ? (
        <p>None 🎉</p>
      ) : (
        <ul className="list-disc list-inside">
          {missing.map((key) => (
            <li key={key}>{key}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

