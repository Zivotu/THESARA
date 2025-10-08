import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readApps, writeApps, type AppRecord } from '../db.js';
import { ensureListingPreview } from '../lib/preview.js';

function findApp(apps: AppRecord[], idOrSlug: string): { app: AppRecord; index: number } | undefined {
  const idx = apps.findIndex((a) => a.id === idOrSlug || a.slug === idOrSlug);
  if (idx === -1) return undefined;
  return { app: apps[idx], index: idx };
}

export default async function versionRoutes(app: FastifyInstance) {
  // List archived versions for an app (owner only)
  app.get('/app/:id/versions', async (req: FastifyRequest, reply: FastifyReply) => {
    const id = (req.params as any).id as string;
    const uid = req.authUser?.uid;
    const apps = await readApps();
    const found = findApp(apps, id);
    if (!found) return reply.code(404).send({ ok: false, error: 'not_found' });
    const { app: record } = found;
    const ownerUid = record.author?.uid || (record as any).ownerUid;
    if (!uid || uid !== ownerUid) {
      return reply.code(403).send({ ok: false, error: 'forbidden' });
    }
    return { archivedVersions: record.archivedVersions ?? [] };
  });

  // Promote an archived build to current
  app.post(
    '/app/:id/versions/:buildId/promote',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id, buildId } = req.params as any;
      const uid = req.authUser?.uid;
      const apps = await readApps();
      const found = findApp(apps, id);
      if (!found) return reply.code(404).send({ ok: false, error: 'not_found' });
      const { app: record, index } = found;
      const ownerUid = record.author?.uid || (record as any).ownerUid;
      if (!uid || uid !== ownerUid) {
        return reply.code(403).send({ ok: false, error: 'forbidden' });
      }
      const archived = record.archivedVersions ?? [];
      const idx = archived.findIndex((v) => v.buildId === buildId);
      if (idx === -1) {
        return reply.code(404).send({ ok: false, error: 'not_found' });
      }
      const now = Date.now();
      const selected = archived[idx];
      const remaining = archived.filter((_, i) => i !== idx);
      if (record.buildId) {
        remaining.push({ buildId: record.buildId, version: record.version ?? 1, archivedAt: now });
      }
      record.buildId = selected.buildId;
      record.version = selected.version;
      record.playUrl = `/play/${record.id}/`;
      record.archivedVersions = remaining;
      record.updatedAt = now;
      const ensured = ensureListingPreview(record);
      const finalRecord = ensured.changed ? ensured.next : record;
      apps[index] = finalRecord;
      await writeApps(apps);
      return { ok: true, item: finalRecord };
    },
  );
}
