import type { FastifyInstance } from 'fastify';

const ALLOWED_HOSTS = [
  'lh3.googleusercontent.com',
  'firebasestorage.googleapis.com',
  'avatars.githubusercontent.com',
];

const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const cache = new Map<string, { buffer: Buffer; type: string; expires: number }>();

export default async function avatarRoutes(app: FastifyInstance) {
  app.get('/avatar/:uid', async (req, reply) => {
    const { url } = (req.query as any) || {};
    if (!url) return reply.code(400).send({ error: 'Missing url' });
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return reply.code(400).send({ error: 'Invalid url' });
    }
    if (!ALLOWED_HOSTS.some((h) => target.hostname === h || target.hostname.endsWith(`.${h}`))) {
      return reply.code(400).send({ error: 'Disallowed url' });
    }
    try {
      const cached = cache.get(url);
      if (cached && cached.expires > Date.now()) {
        reply.type(cached.type);
        reply.header('Cache-Control', 'public, max-age=86400');
        return reply.send(cached.buffer);
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(target, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return reply.code(res.status).send({ error: 'Upstream error' });
      const buffer = Buffer.from(await res.arrayBuffer());
      const type = res.headers.get('content-type') || 'image/jpeg';
      cache.set(url, { buffer, type, expires: Date.now() + CACHE_TTL_MS });
      reply.type(type);
      reply.header('Cache-Control', 'public, max-age=86400');
      reply.send(buffer);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        reply.code(504).send({ error: 'Fetch timed out' });
      } else if (!reply.sent) {
        reply.code(500).send({ error: 'Fetch failed' });
      }
    }
  });
}
