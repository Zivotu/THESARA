import { joinUrl } from './url';
import { getApiBase, INTERNAL_API_URL as RESOLVED_INTERNAL_API_URL } from './apiBase';

export interface WebConfig {
  API_URL: string;
  SAFE_PUBLISH_ENABLED: boolean;
  SANDBOX_SUBDOMAIN_ENABLED: boolean;
  ROOMS_ENABLED: boolean;
  SITE_NAME: string;
  MAX_APPS_PER_USER: number;
  GOLD_MAX_APPS_PER_USER: number;
  MAX_ROOMS_PER_APP: number;
  MAX_PLAYERS_PER_ROOM: number;
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    appId: string;
    storageBucket: string;
    messagingSenderId: string;
  };
}

function must(value: string | undefined, key: string): string {
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${key}`);
  }
  return value;
}

function resolveApiUrl(apiUrlStr: string): string {
  if (apiUrlStr.startsWith('/') && typeof window !== 'undefined') {
    return `${window.location.origin}${apiUrlStr}`;
  }
  return apiUrlStr;
}


export async function isFirebaseConfiguredClient(): Promise<boolean> {
  if (typeof window === 'undefined') {
    return true;
  }
  const { getMissingFirebaseEnv } = await import('./env');
  return getMissingFirebaseEnv().length === 0;
}

export function getConfig(): WebConfig | null {
  try {
    const rawApiUrl =
      typeof window === 'undefined' ? RESOLVED_INTERNAL_API_URL : getApiBase();
    const API_URL = resolveApiUrl(rawApiUrl).replace(/\/$/, '');
    return {
      API_URL,
      SAFE_PUBLISH_ENABLED: process.env.SAFE_PUBLISH_ENABLED === 'true',
      SANDBOX_SUBDOMAIN_ENABLED: process.env.SANDBOX_SUBDOMAIN_ENABLED !== 'false',
      ROOMS_ENABLED: process.env.ROOMS_ENABLED === 'true',
      SITE_NAME: process.env.NEXT_PUBLIC_SITE_NAME || 'CreateX',
      MAX_APPS_PER_USER: Number(process.env.NEXT_PUBLIC_MAX_APPS_PER_USER || '2'),
      GOLD_MAX_APPS_PER_USER: Number(
        process.env.NEXT_PUBLIC_GOLD_MAX_APPS_PER_USER || '10',
      ),
      MAX_ROOMS_PER_APP: Number(process.env.NEXT_PUBLIC_MAX_ROOMS_PER_APP || '10'),
      MAX_PLAYERS_PER_ROOM: Number(process.env.NEXT_PUBLIC_MAX_PLAYERS_PER_ROOM || '100'),
      firebase: {
        apiKey: must(process.env.NEXT_PUBLIC_FIREBASE_API_KEY, 'NEXT_PUBLIC_FIREBASE_API_KEY'),
        authDomain: must(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'),
        projectId: must(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 'NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
        appId: must(process.env.NEXT_PUBLIC_FIREBASE_APP_ID, 'NEXT_PUBLIC_FIREBASE_APP_ID'),
        storageBucket: must(
          process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
          'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
        ),
        messagingSenderId: must(
          process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
          'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
        ),
      },
    };
  } catch (err) {
    if (typeof window === 'undefined') {
      throw err;
    }
    console.error(err);
    return null;
  }
}

let API_URL = '';
let SAFE_PUBLISH_ENABLED = false;
let SANDBOX_SUBDOMAIN_ENABLED = true;
let ROOMS_ENABLED = false;
let SITE_NAME = 'CreateX';
let MAX_APPS_PER_USER = 2;
let GOLD_MAX_APPS_PER_USER = 10;
let MAX_ROOMS_PER_APP = 10;
let MAX_PLAYERS_PER_ROOM = 100;

try {
  const cfg = getConfig();
  if (!cfg) {
    throw new Error('Missing Firebase configuration');
  }
  ({
    API_URL,
    SAFE_PUBLISH_ENABLED,
    SANDBOX_SUBDOMAIN_ENABLED,
    ROOMS_ENABLED,
    SITE_NAME,
    MAX_APPS_PER_USER,
    GOLD_MAX_APPS_PER_USER,
    MAX_ROOMS_PER_APP,
    MAX_PLAYERS_PER_ROOM,
  } = cfg);
} catch (err) {
  if (typeof window === 'undefined') {
    throw err;
  }
  console.error(err);
  if (typeof document !== 'undefined') {
    document.body.innerHTML = '<div class="p-4">Configuration error. Please check environment settings.</div>';
  }
}

export {
  API_URL,
  SAFE_PUBLISH_ENABLED,
  SANDBOX_SUBDOMAIN_ENABLED,
  ROOMS_ENABLED,
  SITE_NAME,
  MAX_APPS_PER_USER,
  GOLD_MAX_APPS_PER_USER,
  MAX_ROOMS_PER_APP,
  MAX_PLAYERS_PER_ROOM,
};

export async function checkApiUrlReachability(baseUrl: string = API_URL): Promise<boolean> {
  if (typeof window === 'undefined') return true;
  const probeUrl = toAbsolute(joinUrl(baseUrl, '/healthz'));
  try {
    const r = await fetch(probeUrl, { method: 'HEAD', credentials: 'include' });
    if (!r.ok) throw new Error('bad status');
    return true;
  } catch {
    try {
      const r2 = await fetch(probeUrl, { method: 'GET', credentials: 'include' });
      return r2.ok;
    } catch {
      return false;
    }
  }
}

function toAbsolute(u: string): string {
  if (/^https?:\/\//.test(u)) return u;
  if (typeof window !== 'undefined') return new URL(u, window.location.origin).toString();
  return u;
}

export { INTERNAL_API_URL } from './apiBase';
