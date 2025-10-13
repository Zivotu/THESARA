
'use client';

import { ToastProvider } from './toasts';

export function ApiProvider({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
