import { db } from './db.js';
import { getConfig } from './config.js';

const { RATE_LIMIT } = getConfig();
const collection = RATE_LIMIT.collection || 'rate_limits';

/**
 * Check and update the timestamp for the given key. Returns true if the key
 * is currently rate limited (i.e. called again within ttlMs), otherwise
 * false and updates the stored timestamp.
 */
export async function isRateLimited(key: string, ttlMs: number): Promise<boolean> {
  const now = Date.now();
  const ref = db.collection(collection).doc(.key);
  try {
    const snap = await ref.get();
    const last = snap.exists ? ((snap.data() as any).ts as number) : 0;
    if (now - last < ttlMs) {
      return true;
    }
    await ref.set({ ts: now, expiresAt: new Date(now + ttlMs) });
    return false;
  } catch (err: any) {
    const code = err?.code || err?.status;
    if (code === 'resource-exhausted' || code === 'RESOURCE_EXHAUSTED' || code === 8) {
      console.warn('Rate limit store quota exceeded', err);
      return false;
    }
    throw err;
  }
}
