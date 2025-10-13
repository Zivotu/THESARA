'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmTone = 'danger',
  requireText,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string | ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmTone?: 'danger' | 'default';
  requireText?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) {
      setText('');
      setTimeout(() => cancelBtnRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const confirmDisabled = requireText ? text.trim() !== requireText : false;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[999] flex items-center justify-center p-4 animate-fadeIn"
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl border border-gray-200 p-6 animate-slideUp">
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        <div className="mt-3 text-gray-600">{message}</div>

        {requireText && (
          <div className="mt-4">
            <label className="block text-xs font-medium text-gray-600 mb-2">
              For safety, type <span className="font-mono px-2 py-1 bg-red-50 text-red-700 rounded">{requireText}</span> to confirm:
            </label>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full border-2 rounded-lg px-3 py-2 focus:border-red-500 focus:ring-4 focus:ring-red-500/10 transition-all"
              placeholder={requireText}
              autoComplete="off"
            />
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            ref={cancelBtnRef}
            onClick={onClose}
            className="px-5 py-2.5 rounded-full border border-gray-300 hover:bg-gray-50 transition-all duration-200 font-medium"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={cn(
              'px-5 py-2.5 rounded-full text-white font-medium transition-all duration-200',
              confirmDisabled
                ? 'bg-gray-400 cursor-not-allowed'
                : confirmTone === 'danger'
                ? 'bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 shadow-md hover:shadow-lg'
                : 'bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 shadow-md hover:shadow-lg'
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

