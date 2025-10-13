
import { createContext } from 'react';
import { Toast } from './types';

export type ToastContextType = {
  addToast: (toast: Omit<Toast, 'id'>) => void;
};

export const ToastContext = createContext<ToastContextType | null>(null);
