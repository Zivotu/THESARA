import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { promises as fsp, createWriteStream } from 'node:fs';
import { getLocalDevConfig } from './env.js';
import { enqueueDevBuild, devBuildQueue, type LocalDevOwner } from './queue.js';
import { sanitizeAppId, ensureDir, tailFile, assertInside } from './utils.js';

export default async function localDevRoutes(app: FastifyInstance) {
  const cfg = getLocalDevConfig();
  await ensureDir(cfg.uploadsDir);
  await ensureDir(cfg.logsDir);
  await ensureDir(cfg.hostedAppsDir);

  async function handleUpload(req: any, reply: any) {
    const auth = (req as any).authUser;
    if (!auth?.uid) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const claims: any = auth.claims ?? {};
    const handleFromClaim =
      typeof claims.handle === 'string' && claims.handle.trim()
        ? String(claims.handle).trim()
        : undefined;
    const handleFromEmail =
      typeof claims.email === 'string' && claims.email.includes('@')
        ? String(claims.email.split('@')[0] || '').trim() || undefined
        : undefined;
    const owner: LocalDevOwner = {
      uid: auth.uid,
      name:
        typeof claims.name === 'string' && claims.name.trim()
          ? String(claims.name).trim()
          : typeof claims.displayName === 'string' && claims.displayName.trim()
          ? String(claims.displayName).trim()
          : undefined,
      handle: handleFromClaim || handleFromEmail,
      email: typeof claims.email === 'string' ? String(claims.email) : undefined,
      photo:
        typeof claims.picture === 'string' && claims.picture.trim()
          ? String(claims.picture).trim()
          : undefined,
    };

    const appId = sanitizeAppId(req.params.appId);
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'no_file' });
    const zipPath = path.join(cfg.uploadsDir, `${appId}-${Date.now()}.zip`);
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(zipPath);
      data.file.pipe(ws).on('finish', () => resolve()).on('error', reject);
    });
    const jobId = await enqueueDevBuild(appId, zipPath, {
      allowScripts: cfg.DEV_ALLOW_SCRIPTS,
      owner,
    });
    return reply.send({ jobId });
  }

  app.post('/apps/:appId/upload', handleUpload);
  app.post('/api/apps/:appId/upload', handleUpload);

  async function handleStatus(req: any, reply: any) {
    const appId = sanitizeAppId(req.params.appId);
    const jobId = String(req.params.jobId);
    const job = await devBuildQueue.getJob(jobId);
    if (!job) return reply.send({ status: 'unknown' });
    const state = await job.getState();
    let result: any;
    try {
      const anyJob = job as any;
      if (typeof anyJob.getReturnValue === 'function') {
        result = await anyJob.getReturnValue();
      } else if (typeof anyJob.returnvalue !== 'undefined') {
        result = anyJob.returnvalue;
      }
    } catch {}
    let logTail: string | undefined;
    if (state === 'failed') {
      const logPath = path.join(cfg.logsDir, appId, `${jobId}.log`);
      logTail = await tailFile(logPath, cfg.DEV_LOG_TAIL_LINES);
    }
    const payload: Record<string, any> = { status: state };
    if (logTail) payload.log = logTail;
    if (result && typeof result === 'object') Object.assign(payload, result);
    return reply.send(payload);
  }

  app.get('/apps/:appId/build-status/:jobId', handleStatus);
  app.get('/api/apps/:appId/build-status/:jobId', handleStatus);

  // Preview static files from local hosted-apps
  app.get('/preview/:appId/*', async (req, reply) => {
    const appId = sanitizeAppId((req.params as any).appId);
    const rest = String((req.params as any)['*'] || '').replace(/^\/+/, '');
    const base = path.join(cfg.hostedAppsDir, appId, 'dist');
    const file = path.join(base, rest || 'index.html');
    assertInside(base, file);
    let target = file;
    try {
      await fsp.access(target);
    } catch {
      target = path.join(base, 'index.html');
    }
    try {
      await fsp.access(target);
    } catch {
      return reply.code(404).send('Not found');
    }
    return reply.sendFile ? reply.sendFile(target) : reply.type(getMime(target)).send(await fsp.readFile(target));
  });

  // Quick health for local dev
  app.get('/api/health', async () => ({ ok: true }));
}

function getMime(p: string): string {
  const ext = path.extname(p).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html';
    case '.js': return 'application/javascript';
    case '.css': return 'text/css';
    case '.json': return 'application/json';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.svg': return 'image/svg+xml';
    case '.woff': return 'font/woff';
    case '.woff2': return 'font/woff2';
    default: return 'application/octet-stream';
  }
}

