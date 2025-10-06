import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readApps, writeApps, type AppRecord } from '../db.js';

function findApp(apps: AppRecord[], idOrSlug: string): { app: AppRecord; index: number } | undefined {
  const idx = apps.findIndex((a) => a.id === idOrSlug || a.slug === idOrSlug);
  if (idx === -1) return undefined;
  return { app: apps[idx], index: idx };
}

export default async function versionRoutes(app: FastifyInstance) {
  // List archived versions for an app (owner only)
  app.get('/app/:id/versions', async (req: FastifyRequest, reply: FastifyReply) => {
    const id = (req.params as any).id as string;
    const uid = req.authUser?.uid;
    const apps = await readApps();
    const found = findApp(apps, id);
    if (!found) return reply.code(404).send({ ok: false, error: 'not_found' });
    const { app: record } = found;
    const ownerUid = record.author?.uid || (record as any).ownerUid;
    if (!uid || uid !== ownerUid) {
      return reply.code(403).send({ ok: false, error: 'forbidden' });
    }
    return { archivedVersions: record.archivedVersions ?? [] };
  });

  // Promote an archived build to current
  app.post(
    '/app/:id/versions/:buildId/promote',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id, buildId } = req.params as any;
      const uid = req.authUser?.uid;
      const apps = await readApps();
      const found = findApp(apps, id);
      if (!found) return reply.code(404).send({ ok: false, error: 'not_found' });
      const { app: record, index } = found;
      const ownerUid = record.author?.uid || (record as any).ownerUid;
      if (!uid || uid !== ownerUid) {
        return reply.code(403).send({ ok: false, error: 'forbidden' });
      }
      const archived = record.archivedVersions ?? [];
      const idx = archived.findIndex((v) => v.buildId === buildId);
      if (idx === -1) {
        return reply.code(404).send({ ok: false, error: 'not_found' });
      }
      const now = Date.now();
      const selected = archived[idx];
      const remaining = archived.filter((_, i) => i !== idx);
      if (record.buildId) {
        remaining.push({ buildId: record.buildId, version: record.version ?? 1, archivedAt: now });
      }
      record.buildId = selected.buildId;
      record.version = selected.version;
      record.playUrl = `/play/${record.id}/`;
      // Point to expected preview; regeneration handled below
      record.previewUrl = `/builds/${selected.buildId}/preview.png`;
      record.archivedVersions = remaining;
      record.updatedAt = now;
      apps[index] = record;
      await writeApps(apps);
      // Best-effort: ensure preview.png exists for promoted build
      try {
        const { getConfig } = await import('../config.js');
        const cfg = getConfig();
        const { getBuildDir } = await import('../paths.js');
        const path = await import('node:path');
        const fs = await import('node:fs/promises');
        const puppeteer = (await import('puppeteer')).default;
        const buildDir = getBuildDir(selected.buildId);
        const outPng = path.join(buildDir, 'preview.png');
        let need = false;
        try { await fs.access(outPng); } catch { need = true; }
        if (need) {
          const bundleIndex = path.join(buildDir, 'bundle', 'index.html');
          let hasLocalBundle = false;
          try { await fs.access(bundleIndex); hasLocalBundle = true; } catch {}
          const publicBase = (cfg.PUBLIC_BASE || `http://127.0.0.1:${cfg.PORT}`).replace(/\/$/, '');
          const url = hasLocalBundle
            ? `file://${bundleIndex.replace(/\\/g, '/')}`
            : `${publicBase}/public/builds/${encodeURIComponent(selected.buildId)}/index.html`;
          const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
          try {
            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
            await page.setRequestInterception(true);
            page.on('request', (r) => {
              const u = r.url();
              try {
                if (u.startsWith('file://') || u.startsWith('data:')) return r.continue();
                if (!hasLocalBundle) {
                  const origin = new URL(url).origin;
                  if (u.startsWith(origin)) return r.continue();
                }
              } catch {}
              r.abort();
            });
            await page.goto(url, { waitUntil: hasLocalBundle ? 'domcontentloaded' : 'networkidle2', timeout: 60000 });
            await new Promise((res) => setTimeout(res, 300));
            await fs.mkdir(path.dirname(outPng), { recursive: true });
            await page.screenshot({ path: outPng as `${string}.png`, type: 'png' });
          } finally {
            await browser.close();
          }
        }
      } catch {}
      return { ok: true, item: record };
    },
  );
}
