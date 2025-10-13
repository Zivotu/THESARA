import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readBuild, type BuildState } from '../models/Build.js';
import { getBuildArtifacts } from '../models/Build.js';
import { enqueueCreatexBuild, QueueDisabledError } from '../workers/createxBuildWorker.js';
import { getBuildData, logBuildStart } from '../db/builds.js';
import { getListingByBuildId, readApps, listEntitlements } from '../db.js';
import { getConfig } from '../config.js';
import { requireRole } from '../middleware/auth.js';
import { getBuildDir } from '../paths.js';

export default async function buildRoutes(app: FastifyInstance) {
  app.post(
    '/build',
    { preHandler: requireRole('user') },
    async (req, reply) => {
      const uid = req.authUser?.uid;
      if (!uid) {
        return reply.code(401).send({ ok: false, error: 'unauthorized' });
      }

      const apps = await readApps();
      const owned = apps.filter(
        (a) => a.author?.uid === uid || (a as any).ownerUid === uid,
      );
      const ents = await listEntitlements(uid);
      const gold = ents.some(
        (e) => e.feature === 'isGold' && e.active !== false,
      );
      const cfg = getConfig();
      const limit = gold ? cfg.GOLD_MAX_APPS_PER_USER : cfg.MAX_APPS_PER_USER;
      if (owned.length >= limit) {
        return reply
          .code(403)
          .send({
            ok: false,
            error: 'max_apps',
            message: `Dosegli ste maksimalan broj aplikacija (${limit})`,
          });
      }

      let buildId: string;
      try {
        buildId = await enqueueCreatexBuild();
      } catch (err) {
        if (err instanceof QueueDisabledError || (err as any)?.code === 'QUEUE_DISABLED') {
          return reply
            .code(503)
            .send({ ok: false, error: 'build_queue_disabled', message: 'Build queue unavailable' });
        }
        req.log.error({ err }, 'enqueue_build_failed');
        return reply.code(500).send({ ok: false, error: 'enqueue_failed' });
      }
      await logBuildStart(buildId, uid);
      reply.send({ buildId });
    },
  );

  app.get('/build/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = await getBuildData(id);
    if (!data) return reply.code(404).send({ ok: false, error: 'not_found' });
    reply.send({ ok: true, ...data });
  });

  app.get('/build/:id/status', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await readBuild(id);
    if (!job) return reply.code(404).send({ ok: false, error: 'not_found' });
    const { state, progress, error } = job;
    try {
      await fs.access(getBuildDir(id));
    } catch (e: any) {
      if (e?.code === 'ENOENT') {
        const dir = getBuildDir(id);
        const required = [
          { name: 'build/AST_SUMMARY.json', path: path.join(dir, 'build', 'AST_SUMMARY.json') },
          { name: 'build/manifest_v1.json', path: path.join(dir, 'build', 'manifest_v1.json') },
          { name: 'llm.json', path: path.join(dir, 'llm.json') },
          { name: 'bundle.zip', path: path.join(dir, 'bundle.zip') },
        ];
        const missing: string[] = [];
        for (const f of required) {
          try {
            await fs.access(f.path);
          } catch (err: any) {
            if (err?.code === 'ENOENT') missing.push(f.name);
          }
        }
        return reply
          .code(404)
          .send({ ok: false, error: 'artifacts_missing', code: 'artifacts_missing', missing });
      }
    }

    const artifacts = await getBuildArtifacts(id);
    // Resolve public URL if bundle uploaded to Firebase Storage
    let publicUrl: string | undefined;
    try {
      const { getBucket } = await import('../storage.js');
      const bucket = getBucket();
      const file = bucket.file(`builds/${id}/index.html`);
      const [exists] = await file.exists();
      if (exists) {
        publicUrl = `/public/builds/${id}/index.html`;
      }
    } catch {}
    const listing = await getListingByBuildId(id);

    const resp: any = { ok: true, state, progress, artifacts };
    if (listing) resp.listingId = listing.id;
    if (error && !resp.error) resp.error = error;
    if (publicUrl) resp.public = publicUrl;
    reply.send(resp);
  });

  app.get('/build/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string };
    let job = await readBuild(id);
    if (!job) return reply.code(404).send({ ok: false, error: 'not_found' });

    const origin = req.headers.origin as string | undefined;
    const cfg = getConfig();
    const allowed =
      typeof cfg.ALLOWED_ORIGINS === 'string' && cfg.ALLOWED_ORIGINS.trim()
        ? cfg.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
    if (origin && (!allowed.length || allowed.includes(origin))) {
      reply.raw.setHeader('Access-Control-Allow-Origin', origin);
      reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    reply.raw.setHeader('Vary', 'Origin');
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');

    reply.hijack();

    const terminalStates = new Set([
      'published',
      'failed',
      'rejected',
      'pending_review',
      'pending_review_llm',
      'approved',
    ]);

    let lastState: BuildState | undefined = undefined;
    let lastProgress = -1;

    const send = async (rec: { state: BuildState; progress: number }) => {
      const payload = JSON.stringify({ state: rec.state, progress: rec.progress });
      reply.raw.write(`event: state\n`);
      reply.raw.write(`data: ${payload}\n\n`);

      if (terminalStates.has(rec.state)) {
        const artifacts = await getBuildArtifacts(id);
        const finalPayload = JSON.stringify({
          state: rec.state,
          artifacts,
          error: (await readBuild(id))?.error,
        });
        reply.raw.write(`event: final\n`);
        reply.raw.write(`data: ${finalPayload}\n\n`);
        reply.raw.end();
      }
    };

    await send(job);
    lastState = job.state;
    lastProgress = job.progress;

    const interval = setInterval(async () => {
      const current = await readBuild(id);
      if (!current) return;
      if (current.state !== lastState || current.progress !== lastProgress) {
        lastState = current.state;
        lastProgress = current.progress;
        await send(current);
      }
    }, 1000);

    const keepAlive = setInterval(() => {
      reply.raw.write(':ka\n\n');
    }, 20000);

    req.raw.on('close', () => {
      clearInterval(interval);
      clearInterval(keepAlive);
    });
  });
}
