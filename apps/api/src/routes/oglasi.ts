import type { FastifyInstance } from 'fastify';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { readOglasi, writeOglasi } from '../db.js';
import type { Oglas } from '../models/Oglas.js';
import { filterOglasi } from '../oglasi.js';

const DEBUG_LISTING_AUTH = process.env.DEBUG_LISTING_AUTH === '1';

async function getUidFromRequest(req: any): Promise<string | undefined> {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    try {
      const decoded = await getAuth().verifyIdToken(token);
      return decoded.uid;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export default async function oglasiRoutes(app: FastifyInstance) {
  app.post('/oglasi', async (req, reply) => {
    const uid = await getUidFromRequest(req);
    if (!uid) return reply.code(401).send({ ok: false, error: 'unauthenticated' });

    const data = (req.body as any) || {};
    const all = await readOglasi();
    const now = Date.now();
    const newId = all.length ? Math.max(...all.map((o) => o.id)) + 1 : 1;
    const item: Oglas = {
      id: newId,
      ownerUid: uid,
      state: 'draft',
      createdAt: now,
      updatedAt: now,
      reports: [],
      ...data,
    } as Oglas;
    all.push(item);
    await writeOglasi(all);
    return { ok: true, item };
  });

  app.put('/oglasi/:id', async (req, reply) => {
    const uid = await getUidFromRequest(req);
    if (!uid) return reply.code(401).send({ ok: false, error: 'unauthenticated' });

    const id = Number((req.params as any).id);
    const updates = (req.body as any) || {};
    const all = await readOglasi();
    const idx = all.findIndex((o) => o.id === id);
    if (idx < 0)
      return reply.code(404).send({ ok: false, error: 'not_found' });
    if (all[idx].ownerUid !== uid)
      return DEBUG_LISTING_AUTH
        ? reply.code(403).send({ ok: false, error: 'not_owner' })
        : reply.code(404).send({ ok: false, error: 'not_found' });
    const item = all[idx];
    if (item.state !== 'draft')
      return reply.code(400).send({ ok: false, error: 'not_editable' });

    const editable = new Set(['title', 'lokacija', 'cijena', 'kategorija', 'slike', 'opis']);
    for (const [k, v] of Object.entries(updates)) {
      if (editable.has(k)) (item as any)[k] = v;
    }
    item.updatedAt = Date.now();
    all[idx] = item;
    await writeOglasi(all);
    return { ok: true, item };
  });

  app.post('/oglasi/:id/publish', async (req, reply) => {
    const uid = await getUidFromRequest(req);
    if (!uid) return reply.code(401).send({ ok: false, error: 'unauthenticated' });

    const id = Number((req.params as any).id);
    const all = await readOglasi();
    const idx = all.findIndex((o) => o.id === id);
    if (idx < 0)
      return reply.code(404).send({ ok: false, error: 'not_found' });
    if (all[idx].ownerUid !== uid)
      return DEBUG_LISTING_AUTH
        ? reply.code(403).send({ ok: false, error: 'not_owner' })
        : reply.code(404).send({ ok: false, error: 'not_found' });
    const item = all[idx];
    if (item.state !== 'draft')
      return reply.code(400).send({ ok: false, error: 'not_editable' });

    const schema = z.object({
      title: z.string().min(1),
      lokacija: z.string().min(1),
      cijena: z.number(),
      kategorija: z.string().min(1),
      slike: z.array(z.string()).min(1),
      opis: z.string().min(1),
    });
    const parsed = schema.safeParse(item);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'invalid_listing' });
    }

    item.state = 'published';
    item.publishedAt = Date.now();
    item.updatedAt = Date.now();
    all[idx] = item;
    await writeOglasi(all);
    return { ok: true, item };
  });

  app.post('/oglasi/:id/moderate', async (req, reply) => {
    const uid = await getUidFromRequest(req);
    if (!uid) return reply.code(401).send({ ok: false, error: 'unauthenticated' });

    const db = getFirestore();
    const modDoc = await db.collection('moderators').doc(uid).get();
    if (!modDoc.exists) return reply.code(403).send({ ok: false, error: 'forbidden' });

    const id = Number((req.params as any).id);
    const { reason } = (req.body as any) || {};
    const all = await readOglasi();
    const idx = all.findIndex((o) => o.id === id);
    if (idx < 0) return reply.code(404).send({ ok: false, error: 'not_found' });

    const now = Date.now();
    all[idx].state = 'inactive';
    all[idx].moderation = { by: uid, reasons: [reason], at: now };
    all[idx].updatedAt = now;
    await writeOglasi(all);
    return { ok: true, item: all[idx] };
  });

  app.post('/oglasi/:id/report', async (req, reply) => {
    const uid = await getUidFromRequest(req);
    if (!uid) return reply.code(401).send({ ok: false, error: 'unauthenticated' });

    const id = Number((req.params as any).id);
    const { reason } = (req.body as any) || {};
    const all = await readOglasi();
    const idx = all.findIndex((o) => o.id === id);
    if (idx < 0) return reply.code(404).send({ ok: false, error: 'not_found' });

    const now = Date.now();
    all[idx].reports = all[idx].reports || [];
    const existingItem = all[idx].reports.find((r) => r.by === uid);
    if (existingItem) {
      // prevent duplicate reports from the same user
      return { ok: true, item: existingItem };
    }
    all[idx].reports!.push({ by: uid, reason, at: now });
    if (all[idx].reports!.length >= 3) {
      all[idx].state = 'inactive';
      all[idx].moderation = { by: 'system', reasons: ['auto-spam'], at: now };
    }
    all[idx].updatedAt = now;
    await writeOglasi(all);
    return { ok: true, item: all[idx] };
  });

  const getListing = async (req: any, reply: any) => {
    const id = Number((req.params as any).id);
    const all = await readOglasi();
    const item = all.find((o) => o.id === id);
    if (!item) return reply.code(404).send({ ok: false, error: 'not_found' });

    const uid = await getUidFromRequest(req);
    const isOwner = uid && uid === item.ownerUid;
    const isModerator = uid && item.moderation?.by === uid;
    if (!isOwner && !isModerator && item.state !== 'published') {
      return DEBUG_LISTING_AUTH
        ? reply.code(403).send({ ok: false, error: 'not_owner' })
        : reply.code(404).send({ ok: false, error: 'not_found' });
    }
    const result: any = { ...item };
    if (!isOwner && !isModerator) delete result.moderation;
    return { ok: true, item: result };
  };

  app.get('/oglasi/:id', getListing);

  const listHandler = async (req: any, reply: any) => {
    try {
      const {
        lokacija,
        cijenaMin,
        cijenaMax,
        kategorija,
        ownerUid,
        page = '1',
        pageSize = '5',
      } = (req.query as any) || {};

      const uid = await getUidFromRequest(req);
      const filtered = await filterOglasi({
        lokacija,
        kategorija,
        cijenaMin: cijenaMin ? Number(cijenaMin) : undefined,
        cijenaMax: cijenaMax ? Number(cijenaMax) : undefined,
        ownerUid,
        requestUid: uid,
      });

      const p = Math.max(parseInt(String(page), 10) || 1, 1);
      const ps = Math.max(parseInt(String(pageSize), 10) || 5, 1);
      const total = filtered.length;
      const start = (p - 1) * ps;
      let items = filtered.slice(start, start + ps);
      items = items.map((it: any) => {
        const isOwner = uid && uid === it.ownerUid;
        const isModerator = uid && it.moderation?.by === uid;
        if (!isOwner && !isModerator) {
          const { moderation, ...rest } = it;
          return rest;
        }
        return it;
      });

      return { ok: true, items, total, page: p, pageSize: ps };
    } catch (e) {
      app.log.error(e);
      return reply.code(500).send({ ok: false, error: 'internal' });
    }
  };

  app.get('/oglasi', listHandler);
}
