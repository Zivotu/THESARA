import { MAX_APPS_PER_USER, GOLD_MAX_APPS_PER_USER } from './config';
import { apiGet } from './api';
import { normalizeEntitlements, normalizeList } from './adapters';

export async function getListingCount(uid: string): Promise<number> {
  const res = await apiGet(`/listings?owner=${encodeURIComponent(uid)}`, {
    cache: 'no-store',
  });
  const { items } = normalizeList(res);
  return items.length;
}

async function getAppLimit(): Promise<number> {
  try {
    const entRes = await apiGet('/me/entitlements', { auth: true });
    const { gold } = normalizeEntitlements(entRes);
    return gold ? GOLD_MAX_APPS_PER_USER : MAX_APPS_PER_USER;
  } catch {
    return MAX_APPS_PER_USER;
  }
}

export async function canPublishApp(
  uid: string,
): Promise<{ ok: boolean; message: string }> {
  const [count, limit] = await Promise.all([getListingCount(uid), getAppLimit()]);
  if (count >= limit) {
    return {
      ok: false,
      message: `Dosegli ste maksimalan broj aplikacija (${limit})`,
    };
  }
  const remaining = limit - count;
  return {
    ok: true,
    message: `Preostalo vam je ${remaining} od ${limit} aplikacija`,
  };
}
