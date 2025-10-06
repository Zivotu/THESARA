import { readApps, writeApps, type AppRecord } from '../db.js';
import { getConfig } from '../config.js';

const { MAX_APPS_PER_USER: FREE_MAX_APPS_PER_USER } = getConfig();

/**
 * Ensure a free user does not exceed the allowed number of active apps.
 * Apps exceeding the limit are marked inactive and reverted to draft status.
 */
export async function enforceAppLimit(userId: string): Promise<void> {
  const apps = await readApps();
  const owned = apps
    .filter((a) => a.author?.uid === userId || (a as any).ownerUid === userId);
  // Active apps are those not explicitly inactive
  const activeApps = owned.filter((a) => a.state !== 'inactive');
  if (activeApps.length <= FREE_MAX_APPS_PER_USER) return;

  const now = Date.now();
  // Keep most recently updated apps
  const sorted = activeApps.sort(
    (a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0),
  );
  const keep = new Set(
    sorted.slice(0, FREE_MAX_APPS_PER_USER).map((a) => a.id),
  );
  let changed = false;
  for (const app of owned) {
    if (!keep.has(app.id) && app.state !== 'inactive') {
      app.state = 'inactive';
      app.status = 'draft';
      app.updatedAt = now;
      changed = true;
    }
  }
  if (changed) {
    await writeApps(apps as AppRecord[]);
  }
}
