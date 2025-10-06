import type { FastifyInstance } from 'fastify';
import { NAME_SHIM } from '../shims/nameShim.js';
import { ROOMS_CLIENT_SHIM } from '../shims/roomsClient.js';

export default async function shims(app: FastifyInstance) {
  app.get('/shims/name.js', async (_req, reply) => {
    reply.type('application/javascript').send(NAME_SHIM);
  });

  // Browser ESM client for platform rooms API
  app.get('/shims/rooms.js', async (_req, reply) => {
    reply.type('application/javascript').send(ROOMS_CLIENT_SHIM);
  });
}
