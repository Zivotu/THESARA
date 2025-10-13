'use client';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Box, Package } from 'lucide-react';

export type BuildState = 'queued' | 'running' | 'success' | 'error';

const targets: Record<BuildState, number> = {
  queued: 20,
  running: 80,
  success: 100,
  error: 100,
};

export default function ProgressModal({
  state,
  error,
  onClose,
}: {
  state: BuildState | null;
  error?: string;
  onClose?: () => void;
  previewUrl?: string; 
  step?: string; 
}) {
  const [progress, setProgress] = useState(0);
  const packages = useMemo(() => Array.from({ length: 5 }), []);

  useEffect(() => {
    if (!state) {
      setProgress(0);
      return;
    }
    const id = setInterval(() => {
      setProgress((current) => {
        const target = targets[state];
        const diff = target - current;
        if (Math.abs(diff) < 0.5) {
            if(state === 'success' || state === 'error') {
                clearInterval(id);
            }
            return target;
        }
        return current + diff * 0.3;
      });
    }, 220);
    return () => clearInterval(id);
  }, [state]);

  const message =
    state === 'error'
      ? error?.trim() || 'An error occurred.'
      : 'Uploading your mini app to Thesara...';

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-white to-sky-50 text-slate-700">
      <h1 className="text-2xl font-semibold mb-8 text-center">
        {state === 'error' ? (
            <span className="text-red-600">{message}</span>
        ) : (
            <>
            Uploading your mini app to <span className="text-emerald-600 font-bold">Thesara</span>...
            </>
        )}
      </h1>

      <div className="relative w-80 h-24 border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-md flex items-center justify-between px-4">
        {packages.map((_, i) => (
          <motion.div
            key={i}
            initial={{ x: -80, y: Math.random() * 30 - 15, opacity: 0 }}
            animate={{
              x: [0, 180, 200],
              opacity: [0, 1, 0],
              scale: [1, 1.2, 0.8],
            }}
            transition={{
              delay: i * 0.5,
              duration: 3,
              repeat: state === 'running' || state === 'queued' ? Infinity : 0,
              repeatDelay: 1.5,
            }}
            className="absolute left-0"
          >
            <Package className="text-amber-500" size={28} />
          </motion.div>
        ))}
        <div className="absolute right-2 bottom-2">
          <Box className="text-emerald-500" size={42} />
        </div>
      </div>

      <div className="w-80 h-3 bg-slate-200 rounded-full mt-6 overflow-hidden">
        <motion.div
          className={`h-full ${state === 'error' ? 'bg-red-500' : 'bg-gradient-to-r from-amber-400 to-emerald-500'}`}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ ease: 'easeOut', duration: 0.5 }}
        />
      </div>

      <p className="mt-2 text-sm text-slate-500">{Math.round(progress)}% complete</p>

      {(state === 'success' || state === 'error') && (
          <button
            onClick={onClose}
            className="mt-6 inline-flex items-center justify-center rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600"
          >
            Close
          </button>
        )}
    </div>
  );
}
