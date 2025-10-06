'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
    // Optionally report error to an external service
    // void fetch('/api/error', {
    //   method: 'POST',
    //   body: JSON.stringify({ message: error.message, digest: error.digest }),
    // });
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
      <h2 className="mb-4 text-2xl font-semibold">Something went wrong</h2>
      {error.digest && (
        <p className="mb-4 text-sm text-gray-500">Reference: {error.digest}</p>
      )}
      {process.env.NODE_ENV === 'development' && (
        <pre className="mb-4 max-w-md overflow-x-auto text-left text-sm text-red-600">
          {error.message}
        </pre>
      )}
      <button
        onClick={() => reset()}
        className="rounded-md bg-emerald-500 px-4 py-2 text-white"
      >
        Try again
      </button>
    </div>
  );
}
