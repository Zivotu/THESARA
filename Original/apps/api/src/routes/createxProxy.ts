import type { FastifyInstance } from 'fastify';

export default async function createxProxy(app: FastifyInstance) {
  const TARGET = 'http://localhost:3000';
  app.all('/api/createx/*', async (req, reply) => {
    const url = TARGET + req.raw.url!;
    const headers: Record<string, any> = { ...req.headers };
    delete headers.host;
    const res = await fetch(url, {
      method: req.method,
      headers: headers as any,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : (req.raw as any),
    });
    reply.status(res.status);
    res.headers.forEach((value, key) => {
      reply.header(key, value);
    });
    const buffer = Buffer.from(await res.arrayBuffer());
    return reply.send(buffer);
  });
}
