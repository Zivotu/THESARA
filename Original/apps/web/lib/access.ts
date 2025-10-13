import { apiGet } from './api';

export async function checkAccess(listingId: string): Promise<boolean> {
  const json = await apiGet<{ allowed?: boolean }>(`/access/${listingId}`, { auth: true });
  return !!json?.allowed;
}
