import type { AppRecord, ArchivedVersion } from '../types.js';

export const ARCHIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function computeNextVersion(app: AppRecord | undefined, now = Date.now()): { version: number; archivedVersions: ArchivedVersion[] } {
  const version = app ? (app.version ?? 1) + 1 : 1;
  const archived: ArchivedVersion[] = app
    ? [
        ...((app.archivedVersions ?? []).filter((v) => now - v.archivedAt < ARCHIVE_TTL_MS)),
        app.buildId ? { buildId: app.buildId, version: app.version ?? 1, archivedAt: now } : undefined,
      ].filter(Boolean) as ArchivedVersion[]
    : [];
  return { version, archivedVersions: archived };
}
