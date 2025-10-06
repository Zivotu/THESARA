import type { FastifyInstance } from 'fastify';

export async function uploadRoutes(app: FastifyInstance) {
  app.post('/upload', async (_req, _reply) => {
    return { ok: true };
  });
}
