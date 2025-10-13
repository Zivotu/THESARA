import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: {
      uid: string;
      role: string;
      claims: DecodedIdToken;
    };
  }
}

const plugin: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = req.headers['authorization'];
    const debug = process.env.DEBUG_AUTH === '1';

    // For development, if no auth header is present, create a mock user.
    if (!auth && process.env.NODE_ENV !== 'production') {
      req.authUser = {
        uid: 'dev-user',
        role: 'admin', // Or 'user', depending on what's more convenient for development
        claims: { uid: 'dev-user', role: 'admin', admin: true } as any,
      };
      if (debug) app.log.info({ authUser: req.authUser }, 'auth:mock');
      return;
    }

    if (!auth || typeof auth !== 'string') {
      if (debug) app.log.info({ hasAuth: false }, 'auth');
      return;
    }
    if (!auth.startsWith('Bearer ')) {
      if (debug) app.log.info({ hasAuth: true, invalid: true }, 'auth');
      return reply.code(401).send({ error: 'invalid authorization format' });
    }
    const token = auth.slice(7).trim();
    try {
      const decoded = await getAuth().verifyIdToken(token);
      const claims: any = decoded;
      const role = claims.role || (claims.admin ? 'admin' : 'user');
      req.authUser = { uid: decoded.uid, role, claims: decoded };
      if (debug) app.log.info({ hasAuth: true, uid: decoded.uid, role }, 'auth');
    } catch (err) {
      if (debug) app.log.info({ hasAuth: true, error: 'invalid' }, 'auth');
      reply.log.debug({ err }, 'auth:verify_failed');
      return reply.code(401).send({ error: 'invalid auth token' });
    }
  });
};

export default fp(plugin);

export function requireRole(allowed: string | string[] = 'admin') {
  const roles = Array.isArray(allowed) ? allowed : [allowed];
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.authUser?.uid) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const role = req.authUser.role;
    const claims = req.authUser.claims as any;
    const isAdmin = claims.admin === true || role === 'admin';
    const ok = isAdmin || roles.includes(role);
    if (!ok) {
      return reply.code(403).send({ error: 'forbidden' });
    }
  };
}
