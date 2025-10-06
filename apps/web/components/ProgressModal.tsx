'use client';
import { useEffect, useState } from 'react';

export type BuildState = 'queued' | 'running' | 'success' | 'error';

const targets: Record<BuildState, number> = {
  queued: 5,
  running: 80,
  success: 100,
  error: 100,
};

export default function ProgressModal({
  state,
  error,
  onClose,
  previewUrl,
  step,
}: {
  state: BuildState | null;
  error?: string;
  onClose?: () => void;
  previewUrl?: string;
  step?: string;
}) {
  const [progress, setProgress] = useState(0);
  // no preview image during build

  useEffect(() => {
    if (!state) return;
    const id = setInterval(() => {
      setProgress((p) => {
        const target = targets[state];
        const diff = target - p;
        if (Math.abs(diff) < 1) return target;
        return p + diff * 0.25;
      });
    }, 250);
    return () => clearInterval(id);
  }, [state]);

  const message = state === 'error' ? error || 'DoÅ¡lo je do greÅ¡ke.' : 'Objava aplikacijeâ€¦';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-80 rounded bg-white p-4 shadow space-y-4 text-center">
        {/* Preview image omitted while building */}
        <div className="w-full rounded bg-gray-200">
          <div
            className="h-2 rounded bg-emerald-600"
            style={{ width: `${progress}%`, transition: 'width 0.2s' }}
          />
        </div>
        {step && <p className="text-xs text-gray-600">Korak: {step}</p>}
        <p className="text-sm">{message}</p>
        {state === 'error' && (
          <button
            onClick={onClose}
            className="mt-2 rounded bg-emerald-600 px-4 py-1 text-white"
          >
            Zatvori
          </button>
        )}
      </div>
    </div>
  );
}

