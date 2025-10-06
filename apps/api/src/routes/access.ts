import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { readApps, writeApps, type AppRecord, listEntitlements } from '../db.js';
import * as sessions from '../sessions.js';
import { hasListingAccess } from '../purchaseAccess.js';

function findApp(apps: AppRecord[], idOrSlug: string): { app: AppRecord; index: number } | undefined {
  const idx = apps.findIndex((a) => a.id === idOrSlug || a.slug === idOrSlug);
  if (idx === -1) return undefined;
  return { app: apps[idx], index: idx };
}

export default async function accessRoutes(app: FastifyInstance) {
  app.get('/access/:listingId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { listingId } = req.params as any;
    const uid = req.authUser?.uid;
    if (!uid) return { allowed: false };
    const ents = await listEntitlements(uid);
    const allowed = hasListingAccess(ents, listingId);
    return { allowed };
  });

  // List active PIN sessions (owner only)
  app.get('/app/:id/pin/sessions', async (req: FastifyRequest, reply: FastifyReply) => {
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
    const sess = await sessions.list(record.id);
    return { sessions: sess };
  });

  // Revoke a specific session (owner only)
  app.post(
    '/app/:id/pin/sessions/:sessionId/revoke',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id, sessionId } = req.params as any;
      const uid = req.authUser?.uid;
      const apps = await readApps();
      const found = findApp(apps, id);
      if (!found) return reply.code(404).send({ ok: false, error: 'not_found' });
      const { app: record } = found;
      const ownerUid = record.author?.uid || (record as any).ownerUid;
      if (!uid || uid !== ownerUid) {
        return reply.code(403).send({ ok: false, error: 'forbidden' });
      }
      await sessions.revoke(record.id, String(sessionId));
      return { ok: true };
    },
  );

  // Rotate PIN for an app (owner only)
  app.post('/app/:id/pin/rotate', async (req: FastifyRequest, reply: FastifyReply) => {
    const id = (req.params as any).id as string;
    const uid = req.authUser?.uid;
    const apps = await readApps();
    const found = findApp(apps, id);
    if (!found) return reply.code(404).send({ ok: false, error: 'not_found' });
    const { app: record, index } = found;
    const ownerUid = record.author?.uid || (record as any).ownerUid;
    if (!uid || uid !== ownerUid) {
      return reply.code(403).send({ ok: false, error: 'forbidden' });
    }

    // generate new pin 4-8 digits
    const pin = Math.floor(1000 + Math.random() * 9000).toString();
    const pinHash = await bcrypt.hash(pin, 10);
    (record as any).pinHash = pinHash;
    apps[index] = record;
    await writeApps(apps);
    await sessions.revokeAll(record.id);
    return { ok: true, pin };
  });
}

