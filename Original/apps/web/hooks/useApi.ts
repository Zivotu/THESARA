
'use client';

import { useToasts } from '../components/toasts';
import { handleFetchError as handleFetchErrorOriginal } from '../lib/handleFetchError';

export function useApi() {
  const { addToast } = useToasts();

  async function apiCall<T>(promise: Promise<T>): Promise<T | undefined> {
    try {
      return await promise;
    } catch (error: any) {
      const message = error?.message || 'An unexpected error occurred.';
      handleFetchErrorOriginal(error, message);
      addToast({ message, type: 'error' });
      return undefined;
    }
  }

  return { apiCall };
}
