import { apiGet } from './api';

const handleCache: Record<string, string> = {};

export async function getCreatorHandle(uid: string): Promise<string | undefined> {
  if (!uid) return undefined;
  if (handleCache[uid]) return handleCache[uid];
  try {
    const res = await apiGet<{ handle?: string }>(
      `creators/id/${encodeURIComponent(uid)}`,
    );
    const handle = res?.handle;
    if (handle) handleCache[uid] = handle;
    return handle;
  } catch {
    return undefined;
  }
}

