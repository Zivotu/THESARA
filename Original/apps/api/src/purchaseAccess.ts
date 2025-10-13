import type { Entitlement } from './entitlements/service.js';

export function hasListingAccess(
  ents: Entitlement[],
  listingId: string
): boolean {
  const now = Date.now();
  return ents.some((e) => {
    if (e.active === false) return false;
    if (e.feature === 'purchase') {
      return (e.data as any).listingId === listingId;
    }
    if (e.feature === 'app-subscription') {
      const data: any = e.data || {};
      if (data.appId !== listingId) return false;
      const expRaw = data.expiresAt ?? data.currentPeriodEnd;
      const exp =
        typeof expRaw === 'string'
          ? Date.parse(expRaw)
          : typeof expRaw === 'number'
            ? expRaw
            : undefined;
      return exp != null && exp > now;
    }
    return false;
  });
}

export { hasListingAccess as hasPurchaseAccess };
