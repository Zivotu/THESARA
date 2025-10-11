﻿import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PKG_ROOT, '../..');

const PROD_BUNDLE_DEFAULT = '/home/conexa/api.thesara.space/storage/bundles';
const PROD_PREVIEW_DEFAULT = '/home/conexa/api.thesara.space/storage/previews';

// Commonly used env flags exposed as simple constants for easy importing
const rawLlmProvider = (process.env.LLM_PROVIDER || '').toLowerCase();
export const LLM_PROVIDER = rawLlmProvider || 'none';
const rawLlmEnabled = (process.env.LLM_REVIEW_ENABLED || '').toLowerCase();
export const LLM_REVIEW_ENABLED = rawLlmEnabled === 'true' || rawLlmEnabled === '1';
export const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const LLM_API_URL =
  process.env.LLM_API_URL || 'https://api.openai.com/v1';
export const LLM_REVIEW_FORCE_ALLOWED =
  process.env.LLM_REVIEW_FORCE_ALLOWED !== 'false';
export const AUTH_DEBUG = process.env.AUTH_DEBUG === '1';
export const LLM_ENDPOINT = process.env.LLM_ENDPOINT;
export const REDIS_URL = (process.env.REDIS_URL || '').trim();
export const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS || 'http://localhost:3000'
)
  .split(',')
  .map((s) => s.trim());
export const REQUIRE_PUBLISH_APPROVAL =
  process.env.REQUIRE_PUBLISH_APPROVAL !== 'false';
export const INJECT_SESSION_SDK = process.env.INJECT_SESSION_SDK !== 'false';
export const STRIPE_AUTOMATIC_TAX =
  process.env.STRIPE_AUTOMATIC_TAX === 'true';

export const CONFIG = {
  REQUIRE_PUBLISH_APPROVAL,
  LLM_REVIEW_ENABLED,
  LLM_PROVIDER,
  LLM_MODEL,
  LLM_API_URL,
  OPENAI_API_KEY: OPENAI_API_KEY || '',
  AUTH_DEBUG,
  LLM_ENDPOINT,
  LLM_REVIEW_FORCE_ALLOWED,
  INJECT_SESSION_SDK,
  STRIPE_AUTOMATIC_TAX,
  REDIS_URL,
};

function getEnv(key: string, def?: string): string {
  const value = process.env[key] ?? def;
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${key}`);
  }
  return value;
}

function parseNumberEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? defaultValue : Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric environment variable ${name}`);
  }
  return value;
}

export function getConfig() {
  const PORT = parseNumberEnv('PORT', 8788);
  const PUBLIC_BASE = process.env.PUBLIC_BASE || `http://127.0.0.1:${PORT}`;
  const WEB_BASE = process.env.WEB_BASE || 'http://localhost:3000';
  const STRIPE_SUCCESS_URL =
    process.env.STRIPE_SUCCESS_URL || `${WEB_BASE}/billing/success`;
  const isProd = process.env.NODE_ENV === 'production';
  const bundleStoragePath = path.resolve(
    process.env.BUNDLE_STORAGE_PATH ??
    (isProd ? PROD_BUNDLE_DEFAULT : path.join(REPO_ROOT, 'storage/bundles'))
  );
  const previewStoragePath = path.resolve(
    process.env.PREVIEW_STORAGE_PATH ??
    (isProd ? PROD_PREVIEW_DEFAULT : path.join(process.cwd(), 'review', 'builds'))
  );
  if (!STRIPE_SUCCESS_URL.includes('/billing/success')) {
    console.warn(
      'STRIPE_SUCCESS_URL does not contain /billing/success; check your configuration.'
    );
  }
  let IP_SALT = process.env.IP_SALT;
  if (!IP_SALT) {
    console.warn('Missing IP_SALT environment variable; using a temporary random salt.');
    IP_SALT = randomBytes(16).toString('hex');
  }
  const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
  const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
  const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
  const hasR2Creds = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
  const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
  const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
  const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;
  const hasFirebaseCreds = !!(
    FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY
  );
  let STORAGE_DRIVER = process.env.STORAGE_DRIVER as
    | 'r2'
    | 'local'
    | 'firebase'
    | undefined;
  if (!STORAGE_DRIVER) STORAGE_DRIVER = hasR2Creds ? 'r2' : 'local';
  if (STORAGE_DRIVER === 'r2' && !hasR2Creds) STORAGE_DRIVER = 'local';
  if (STORAGE_DRIVER === 'firebase' && !hasFirebaseCreds) STORAGE_DRIVER = 'local';
  const LOCAL_STORAGE_DIR =
    process.env.LOCAL_STORAGE_DIR || path.resolve(REPO_ROOT, 'storage/uploads');
  return {
    PORT,
    BUNDLE_STORAGE_PATH: bundleStoragePath,
    PREVIEW_STORAGE_PATH: previewStoragePath,
    TMP_PATH: process.env.TMP_PATH || path.resolve(PKG_ROOT, 'tmp'),
    CDN_CACHE_PATH:
      process.env.CDN_CACHE_PATH || path.resolve(REPO_ROOT, 'storage/cdn-cache'),
    LOCAL_STORAGE_DIR,
    STORAGE_DRIVER,
    PUBLIC_BASE,
    APPS_BASE_URL: process.env.APPS_BASE_URL || `${PUBLIC_BASE}/play`,
      WEB_BASE,
      SAFE_PUBLISH_ENABLED: process.env.SAFE_PUBLISH_ENABLED === 'true',
    INJECT_SESSION_SDK,
    LLM_REVIEW_ENABLED,
    LLM_PROVIDER,
    LLM_MODEL,
    LLM_API_URL,
    LLM_REVIEW_FORCE_ALLOWED,
    AUTH_DEBUG,
    LLM_ENDPOINT,
    REQUIRE_PUBLISH_APPROVAL,
      SANDBOX_SUBDOMAIN_ENABLED: process.env.SANDBOX_SUBDOMAIN_ENABLED !== 'false',
      SANDBOX_BASE_DOMAIN: process.env.SANDBOX_BASE_DOMAIN,
      ROOMS_ENABLED: process.env.ROOMS_ENABLED === 'true',
      COOKIE_DOMAIN: process.env.COOKIE_DOMAIN,
      IP_SALT,
      REACT_VERSION: process.env.REACT_VERSION || '18.2.0',
    HTTPS_KEY: process.env.HTTPS_KEY,
    HTTPS_CERT: process.env.HTTPS_CERT,
    ALLOWED_ORIGINS:
      process.env.ALLOWED_ORIGINS || undefined,
    CDN_BASE: process.env.CDN_BASE || 'https://esm.sh',
    REDIS_URL,
    EXTERNAL_HTTP_ESM: process.env.EXTERNAL_HTTP_ESM === 'true',
    // Liberal import policy by default unless explicitly turned off
    // Set ALLOW_ANY_NPM=0 to enforce allow-list from cdnImportPlugin
    ALLOW_ANY_NPM: process.env.ALLOW_ANY_NPM !== '0',
    // Optional CDN allow-list and pin map (JSON or CSV envs)
    CDN_ALLOW: (process.env.CDN_ALLOW || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    CDN_PIN: (() => {
      try {
        return process.env.CDN_PIN ? JSON.parse(process.env.CDN_PIN) : undefined;
      } catch {
        return undefined;
      }
    })(),
    PROXY_FETCH_MAX_PER_MIN: parseNumberEnv('PROXY_FETCH_MAX_PER_MIN', 60),
    PROXY_FETCH_DOMAIN_MAX_PER_MIN: parseNumberEnv(
      'PROXY_FETCH_DOMAIN_MAX_PER_MIN',
      60
    ),
    PROXY_FETCH_MAX_BYTES: parseNumberEnv(
      'PROXY_FETCH_MAX_BYTES',
      5 * 1024 * 1024
    ),
    MAX_APPS_PER_USER: parseNumberEnv('MAX_APPS_PER_USER', 2),
    GOLD_MAX_APPS_PER_USER: parseNumberEnv('GOLD_MAX_APPS_PER_USER', 10),
    MAX_STORAGE_MB_PER_USER: parseNumberEnv('MAX_STORAGE_MB_PER_USER', 100),
    GOLD_MAX_STORAGE_MB_PER_USER: parseNumberEnv(
      'GOLD_MAX_STORAGE_MB_PER_USER',
      1000,
    ),
    MAX_ROOMS_PER_APP: parseNumberEnv('MAX_ROOMS_PER_APP', 10),
    MAX_PLAYERS_PER_ROOM: parseNumberEnv('MAX_PLAYERS_PER_ROOM', 100),
    ROOM_JOIN_MAX_PER_5MIN: parseNumberEnv('ROOM_JOIN_MAX_PER_5MIN', 20),
    ROOM_EVENTS_RPS_PER_ROOM: parseNumberEnv('ROOM_EVENTS_RPS_PER_ROOM', 5),
    ROOM_EVENTS_BURST_PER_ROOM: parseNumberEnv('ROOM_EVENTS_BURST_PER_ROOM', 20),
    R2_BUCKET_URL: process.env.R2_BUCKET_URL,
    R2_BUCKET: process.env.R2_BUCKET,
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    FIREBASE: {
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY,
      storageBucket:
        process.env.FIREBASE_STORAGE_BUCKET ||
        process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
        'createx-e0ccc.appspot.com',
    },
    NODE_ENV: process.env.NODE_ENV || 'development',
    STRIPE: {
      secretKey: getEnv('STRIPE_SECRET_KEY'),
      webhookSecret: getEnv('STRIPE_WEBHOOK_SECRET'),
      successUrl: STRIPE_SUCCESS_URL,
      cancelUrl: getEnv('STRIPE_CANCEL_URL'),
      platformFeePercent: parseNumberEnv('PLATFORM_FEE_PERCENT', 0),
      goldPriceId: process.env.GOLD_PRICE_ID ?? '',
      noadsPriceId: process.env.NOADS_PRICE_ID ?? '',
      logoUrl: process.env.STRIPE_LOGO_URL || '',
      primaryColor: process.env.STRIPE_PRIMARY_COLOR || '',
      automaticTax: STRIPE_AUTOMATIC_TAX,
    },
    PRICE_MIN: parseNumberEnv('PRICE_MIN', 0),
    PRICE_MAX: parseNumberEnv('PRICE_MAX', 1000),
    DATABASE_URL:
      process.env.DATABASE_URL || path.resolve(REPO_ROOT, 'storage/data.db'),
    PIN_SESSION_PATH:
      process.env.PIN_SESSION_PATH || path.resolve(REPO_ROOT, 'storage', 'pin-sessions.json'),
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ADMIN_NOTIFIER: {
      smtpHost: process.env.SMTP_HOST,
      smtpPort: parseNumberEnv('SMTP_PORT', 587),
      smtpUser: process.env.SMTP_USER,
      smtpPass: process.env.SMTP_PASS,
      emailFrom: process.env.ADMIN_EMAIL_FROM,
    },
    RATE_LIMIT: {
      backend: process.env.RATE_LIMIT_BACKEND || 'firestore',
      redisUrl: REDIS_URL,
      collection: process.env.RATE_LIMIT_COLLECTION || 'rate_limits',
    },
  };
}
