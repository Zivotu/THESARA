import { LLM_REVIEW_ENABLED, LLM_PROVIDER } from './config.js';

export function validateEnv() {
  if (LLM_REVIEW_ENABLED && LLM_PROVIDER === 'openai') {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required when LLM_REVIEW_ENABLED=true and LLM_PROVIDER=openai');
    }
    if (!process.env.LLM_ENDPOINT) {
      process.env.LLM_ENDPOINT = 'https://api.openai.com/v1';
    }
    if (!process.env.LLM_API_URL) {
      process.env.LLM_API_URL = 'https://api.openai.com/v1';
    }
  }
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (apiUrl && !apiUrl.startsWith('/')) {
    try {
      const u = new URL(apiUrl);
      if (!u.protocol || !u.hostname) throw new Error();
    } catch {
      throw new Error('NEXT_PUBLIC_API_URL must be an absolute URL or start with /');
    }
  }
  if (!process.env.JWT_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET is required in production.');
    }
    console.warn('JWT_SECRET missing; using development fallback secret.');
  }
  const argonNumeric = [
    ['ARGON2_MEMORY_COST', 4096],
    ['ARGON2_TIME_COST', 3],
    ['ARGON2_PARALLELISM', 1],
  ] as const;
  for (const [key, def] of argonNumeric) {
    const raw = process.env[key];
    if (raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${key} must be a positive number (received "${raw}")`);
    }
  }
}
