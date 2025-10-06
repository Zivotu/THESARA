import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createHmac } from 'node:crypto';
import { readApps } from '../db.js';
import { getConfig } from '../config.js';
import { requireRole } from '../middleware/auth.js';

export default async function ownerRoutes(app: FastifyInstance) {
  app.post('/owner/session', { preHandler: requireRole(['user']) }, async (req: FastifyRequest, reply: FastifyReply) => {
    const schema = z.object({ appId: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'invalid_input' });
    }
    const { appId } = parsed.data;
    const uid = req.authUser!.uid;
    try {
      const apps = await readApps();
      const record = apps.find((a: any) => a.id === appId || a.slug === appId);
      if (!record) {
        return reply.code(404).send({ ok: false, error: 'not_found' });
      }
      const ownerUid = record.author?.uid || (record as any).ownerUid;
      if (uid !== ownerUid) {
        return reply.code(403).send({ ok: false, error: 'not_owner' });
      }
      const cfg = getConfig();
      const payload = JSON.stringify({ uid });
      const sig = createHmac('sha256', cfg.IP_SALT).update(payload).digest('hex');
      const value = Buffer.from(`${payload}.${sig}`).toString('base64url');
      const maxAge = 30 * 24 * 60 * 60; // 30 days
      reply.setCookie('cx_owner', value, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge,
        secure: cfg.NODE_ENV === 'production',
      });
      return reply.send({ ok: true });
    } catch (e) {
      app.log.error(e, 'owner_session_failed');
      return reply.code(500).send({ ok: false, error: 'owner_session_failed' });
    }
  });
}
