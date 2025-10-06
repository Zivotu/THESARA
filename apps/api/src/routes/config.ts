import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '../config.js';
import { requireRole } from '../middleware/auth.js';
import { getBucket } from '../storage.js';
import { getBuildDir } from '../paths.js';
import { readApps } from '../db.js';

export default async function configRoutes(app: FastifyInstance) {
  app.get('/config', async () => {
    const { PRICE_MIN, PRICE_MAX } = getConfig();
    return { priceMin: PRICE_MIN, priceMax: PRICE_MAX };
  });

  // Debug endpoint to verify Storage configuration
  app.get('/debug/storage', { preHandler: requireRole('admin') }, async (_req) => {
    const cfg = getConfig();
    try {
      const bucket = getBucket();
      const [exists] = await bucket.exists();
      return { driver: cfg.STORAGE_DRIVER, bucket: bucket.name, exists };
    } catch (err: any) {
      return { driver: cfg.STORAGE_DRIVER, error: String(err?.message || err) };
    }
  });

  // Quick build diagnostics: local vs bucket
  app.get('/debug/build/:id', { preHandler: requireRole('admin') }, async (req) => {
    const { id } = req.params as { id: string };
    const dir = getBuildDir(id);
    const local = {
      bundleIndex: path.join(dir, 'bundle', 'index.html'),
      rootIndex: path.join(dir, 'index.html'),
    };
    const localExists = {
      bundleIndex: await fs.access(local.bundleIndex).then(() => true).catch(() => false),
      rootIndex: await fs.access(local.rootIndex).then(() => true).catch(() => false),
    };
    let bucketExists = { index: false, bundle: false };
    try {
      const b = getBucket();
      const [e1] = await b.file(`builds/${id}/index.html`).exists();
      const [e2] = await b.file(`builds/${id}/bundle.tar.gz`).exists();
      bucketExists = { index: e1, bundle: e2 };
    } catch {}
    const apps = await readApps();
    const item = apps.find((a) => (a as any).buildId === id);
    return { id, local: { ...local, exists: localExists }, bucketExists, listing: item };
  });
}
