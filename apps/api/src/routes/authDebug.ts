import type { FastifyInstance } from 'fastify';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getApp } from 'firebase-admin/app';
import { requireRole } from '../middleware/auth.js';
import { createOrReuseAccount } from '../billing/service.js';
import { getConfig } from '../config.js';

export default async function authDebug(app: FastifyInstance) {
  app.get('/__auth_debug', async (req, reply) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'missing authorization header' });
    }
    const token = authHeader.slice('Bearer '.length).trim();
    try {
      const decoded = await getAuth().verifyIdToken(token);
      const uid = decoded.uid;
      const snap = await getFirestore().collection('users').doc(uid).get();
      const roleInDb = snap.exists ? (snap.data() as any).role : undefined;
      const projectId = getApp().options.projectId;
      return { uid, claims: decoded, roleInDb, projectId };
    } catch (err: any) {
      return reply.code(401).send({ error: 'invalid token', message: err.message });
    }
  });

  app.get('/debug/fix-onboarding', { preHandler: requireRole('user') }, async (req, reply) => {
    const uid = req.authUser!.uid;
    const { WEB_BASE } = getConfig();
    try {
      const { url } = await createOrReuseAccount(
        uid,
        `${WEB_BASE}/u/${uid}/finances?onboarding=1`,
      );
      return reply.send({ ok: true, url: url || null });
    } catch (err: any) {
      req.log.error(err, 'fix-onboarding_failed');
      return reply.code(500).send({ error: 'onboarding_failed', message: err.message });
    }
  });
}

