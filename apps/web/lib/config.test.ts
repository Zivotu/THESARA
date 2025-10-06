import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const env = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = {
    ...env,
    NEXT_PUBLIC_API_URL: '/api/',
    NEXT_PUBLIC_FIREBASE_API_KEY: 'x',
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'x',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'x',
    NEXT_PUBLIC_FIREBASE_APP_ID: 'x',
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'x',
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 'x',
  };
  delete (globalThis as any).window;
});

afterEach(() => {
  process.env = env;
  vi.unstubAllGlobals();
  delete (globalThis as any).window;
});

describe('getConfig', () => {
  it('returns relative API_URL on the client', async () => {
    const { getConfig } = await import('./config');
    const cfg = getConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.API_URL).toBe('/api');
  });

});

