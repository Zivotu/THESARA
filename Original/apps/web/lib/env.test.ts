import { describe, it, expect } from 'vitest';
import { getMissingFirebaseEnv, REQUIRED_FIREBASE_KEYS } from './env';

describe('getMissingFirebaseEnv', () => {
  it('returns missing keys', () => {
    const env = { NEXT_PUBLIC_FIREBASE_API_KEY: 'x' } as Record<string, string>;
    const missing = getMissingFirebaseEnv(env);
    expect(missing).toContain('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN');
  });

  it('returns empty array when all keys present', () => {
    const env: Record<string, string> = Object.fromEntries(
      REQUIRED_FIREBASE_KEYS.map((k) => [k, '1']),
    );
    expect(getMissingFirebaseEnv(env)).toEqual([]);
  });
});
