'use client';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Box, Package } from 'lucide-react';

export type BuildState = 'queued' | 'running' | 'success' | 'error';

const targets: Record<BuildState, number> = {
  queued: 5,
  running: 80,
  success: 100,
  error: 100,
};

const messages: Record<BuildState, string> = {
  queued: 'Pripremamo tvoju objavu...',
  running: 'Pakiramo tvoju mini aplikaciju za Thesara...',
  success: 'Objava je gotova!',
  error: 'Doslo je do greske.',
};

export default function ProgressModal({
  state,
  error,
  onClose,
  previewUrl: _previewUrl,
  step,
}: {
  state: BuildState | null;
  error?: string;
  onClose?: () => void;
  previewUrl?: string;
  step?: string;
}) {
  const [progress, setProgress] = useState(0);
  const packageSlots = useMemo(() => Array.from({ length: 5 }), []);

  useEffect(() => {
    if (!state) return;
    const id = setInterval(() => {
      setProgress((current) => {
        const target = targets[state];
        const diff = target - current;
        if (Math.abs(diff) < 0.5) return target;
        return current + diff * 0.3;
      });
    }, 220);
    return () => clearInterval(id);
  }, [state]);

  useEffect(() => {
    if (!state) {
      setProgress(0);
    }
  }, [state]);

  const message =
    state === 'error'
      ? error?.trim() || messages.error
      : state
        ? messages[state]
        : 'Spremamo se za objavu...';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur">
      <div className="relative w-full max-w-md rounded-3xl border border-slate-800/80 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-8 text-center shadow-2xl">
        <div className="mb-8 space-y-2">
          <h2 className="text-lg font-semibold text-emerald-100">Slanje tvoje mini aplikacije</h2>
          <p className="text-sm text-slate-400">{message}</p>
          {step && <p className="text-xs uppercase tracking-wide text-emerald-400">Korak: {step}</p>}
        </div>

        <div className="relative mx-auto flex h-28 w-full max-w-xs items-center justify-between overflow-hidden rounded-3xl border border-slate-800/70 bg-slate-950/60 px-6">
          {packageSlots.map((_, index) => (
            <motion.div
              key={index}
              initial={{ x: -70, y: Math.random() * 24 - 12, opacity: 0 }}
              animate={{
                x: [0, 140, 160],
                opacity: [0, 1, 0],
                scale: [0.9, 1.1, 0.8],
              }}
              transition={{
                delay: index * 0.45,
                duration: 2.6,
                repeat: Infinity,
                repeatDelay: 1.3,
              }}
              className="absolute left-0"
            >
              <Package className="text-amber-400" size={28} />
            </motion.div>
          ))}
          <div className="pointer-events-none absolute right-4 bottom-3">
            <Box className="text-emerald-400" size={42} />
          </div>
        </div>

        <div className="mt-8 space-y-2">
          <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
            <motion.div
              className="h-full bg-gradient-to-r from-amber-400 via-emerald-400 to-emerald-500"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
              transition={{ ease: 'easeOut', duration: 0.4 }}
            />
          </div>
          <p className="text-xs text-slate-400">{Math.round(progress)}% gotovo</p>
        </div>

        {state === 'error' && (
          <button
            onClick={onClose}
            className="mt-6 inline-flex items-center justify-center rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
          >
            Zatvori
          </button>
        )}
      </div>
    </div>
  );
}
