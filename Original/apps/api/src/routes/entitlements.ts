import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireRole } from '../middleware/auth.js';
import * as ent from '../entitlements/service.js';

export default async function entitlementsRoutes(app: FastifyInstance) {
  app.post(
    '/users/:uid/entitlements',
    { preHandler: requireRole(['user', 'admin']) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { uid } = req.params as { uid: string };
      const authUid = req.authUser!.uid;
      const isAdmin = req.authUser!.role === 'admin';
      if (uid !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      try {
        const item = await ent.create(uid, req.body as any);
        return item;
      } catch (err) {
        req.log.error({ err }, 'entitlement_create_failed');
        return reply.code(400).send({ error: 'entitlement_create_failed' });
      }
    },
  );

  app.delete(
    '/users/:uid/entitlements/:id',
    { preHandler: requireRole(['user', 'admin']) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { uid, id } = req.params as { uid: string; id: string };
      const authUid = req.authUser!.uid;
      const isAdmin = req.authUser!.role === 'admin';
      if (uid !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      try {
        await ent.remove(uid, id);
        return { ok: true };
      } catch (err) {
        req.log.error({ err }, 'entitlement_remove_failed');
        return reply
          .code(500)
          .send({ error: 'entitlement_remove_failed' });
      }
    },
  );
}
