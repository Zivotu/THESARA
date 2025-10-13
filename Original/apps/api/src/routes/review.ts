import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { getAuth } from 'firebase-admin/auth';
import { requireRole } from '../middleware/auth.js';
import { getBucket } from '../storage.js';
import * as tar from 'tar';
import {
  listBuilds,
  readBuild,
  updateBuild,
  getBuildArtifacts,
  publishBundle,
} from '../models/Build.js';
import { getConfig, LLM_REVIEW_ENABLED } from '../config.js';
import { notifyAdmins } from '../notifier.js';
import { BUNDLE_ROOT } from '../paths.js';
import { readApps, writeApps } from '../db.js';
import { runLlmReviewForBuild } from '../llmReview.js';
import { computeNextVersion } from '../lib/versioning.js';
import { ensureListingPreview } from '../lib/preview.js';

export default async function reviewRoutes(app: FastifyInstance) {
  const admin = { preHandler: requireRole('admin') };

  app.get('/review/config', admin, async (req) => {
    return { llmReviewEnabled: LLM_REVIEW_ENABLED, uid: req.authUser?.uid };
  });

  app.get('/review/builds', admin, async (req, reply) => {
    const { status, cursor } = req.query as { status?: string; cursor?: string };
    const { items, nextCursor } = await listBuilds(cursor ? Number(cursor) : undefined);
    const apps = await readApps();
    const allowed = ['pending_review', 'pending_review_llm', 'rejected', 'approved', 'published'];
    let builds = items.filter((b) => allowed.includes(b.state));
    if (status === 'pending') {
      builds = builds.filter((b) => ['pending_review', 'pending_review_llm'].includes(b.state));
    } else if (status === 'approved') {
      builds = builds.filter((b) => ['approved', 'published'].includes(b.state));
    } else if (status === 'rejected') {
      builds = builds.filter((b) => b.state === 'rejected');
    }
    const cfg = (await import('../config.js')).getConfig();
    // cache for uid->email lookups to avoid duplicate admin calls
    const emailCache = new Map<string, string | undefined>();
    const auth = getAuth();
    builds = await Promise.all(
      builds.map(async (b) => {
        // Match the app listing by pendingBuildId/buildId (fallback id equality)
        const listing: any = apps.find(
          (a: any) => a.pendingBuildId === b.id || a.buildId === b.id || String(a.id) === b.id,
        );
        let networkDomains: string[] | undefined;
        let llm: any | undefined;
        try {
          const p = path.join(cfg.BUNDLE_STORAGE_PATH, 'builds', b.id, 'build', 'manifest_v1.json');
          const txt = await fs.readFile(p, 'utf8');
          const j = JSON.parse(txt);
          if (Array.isArray(j?.networkDomains)) networkDomains = j.networkDomains;
        } catch {}
        try {
          const llmPath = path.join(cfg.BUNDLE_STORAGE_PATH, 'builds', b.id, 'llm.json');
          const raw = await fs.readFile(llmPath, 'utf8');
          llm = JSON.parse(raw);
        } catch {
          if (b.state === 'llm_generating' || b.state === 'llm_waiting') {
            llm = { status: 'generating' };
          }
        }
        // Resolve owner email from listing.author.uid if available
        let ownerEmail: string | undefined = (listing as any)?.ownerEmail;
        const uid = (listing as any)?.author?.uid;
        if (!ownerEmail && uid) {
          if (emailCache.has(uid)) ownerEmail = emailCache.get(uid);
          else {
            try {
              const user = await auth.getUser(uid);
              ownerEmail = user.email || undefined;
            } catch {}
            emailCache.set(uid, ownerEmail);
          }
        }
        return {
          ...b,
          // Normalize field names expected by the admin UI
          submittedAt: b.createdAt,
          title: listing?.title ?? '',
          description: listing?.description,
          appId: listing?.id,
          slug: listing?.slug,
          createdAt: listing?.createdAt,
          updatedAt: listing?.updatedAt,
          publishedAt: listing?.publishedAt,
          version: listing?.version,
          playUrl: listing?.playUrl,
          visibility: listing?.visibility,
          accessMode: listing?.accessMode,
          author: listing?.author,
          ownerEmail,
          previewUrl: listing?.previewUrl,
          networkPolicy: (b as any).networkPolicy,
          networkPolicyReason: (b as any).networkPolicyReason,
          networkDomains,
          ...(llm ? { llm } : {}),
        } as any;
      })
    );
    reply.send({ items: builds, nextCursor });
  });

  app.get('/review/builds/:id', admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = await readBuild(id);
    if (!rec) return reply.code(404).send({ error: 'not_found' });
    try {
      const cfg = (await import('../config.js')).getConfig();
      const p = path.join(cfg.BUNDLE_STORAGE_PATH, 'builds', id, 'build', 'manifest_v1.json');
      const txt = await fs.readFile(p, 'utf8');
      const j = JSON.parse(txt);
      const networkDomains = Array.isArray(j?.networkDomains) ? j.networkDomains : undefined;
      return { ...rec, networkDomains } as any;
    } catch {
      return rec;
    }
  });

  app.get('/review/builds/:id/llm', admin, async (req, reply) => {
    if (!LLM_REVIEW_ENABLED) {
      return reply.code(503).send({ error: 'llm_disabled' });
    }
    const { id } = req.params as { id: string };
    const rec = await readBuild(id);
    if (!rec) return reply.code(404).send({ error: 'not_found' });
    if (rec.state === 'llm_generating' || rec.state === 'llm_waiting') {
      return reply.code(503).send({ error: 'report_generating' });
    }
    const cfg = getConfig();
    const p = rec.llmReportPath
      ? path.join(cfg.BUNDLE_STORAGE_PATH, rec.llmReportPath)
      : path.join(cfg.BUNDLE_STORAGE_PATH, 'builds', id, 'llm.json');
    try {
      const txt = await fs.readFile(p, 'utf8');
      return JSON.parse(txt);
    } catch {
      return reply.code(404).send({ error: 'report_not_found' });
    }
  });

  app.post('/review/builds/:id/llm', admin, async (req, reply) => {
    if (!LLM_REVIEW_ENABLED) {
      return reply.code(503).send({ error: 'llm_disabled' });
    }
    const { id } = req.params as { id: string };
    const rec = await readBuild(id);
    if (!rec) return reply.code(404).send({ error: 'not_found' });
    await updateBuild(id, { state: 'llm_generating' });
    try {
      const report = await runLlmReviewForBuild(id);
      const cfg = getConfig();
      const p = path.join(cfg.BUNDLE_STORAGE_PATH, 'builds', id, 'llm.json');
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, JSON.stringify(report, null, 2));
      const rel = path.relative(cfg.BUNDLE_STORAGE_PATH, p);
      await updateBuild(id, { state: 'pending_review', llmReportPath: rel });
      return report;
    } catch (err: any) {
      req.log.error({ err, id }, 'llm_review_failed');
      const code = err?.errorCode || err?.code;
      await updateBuild(id, { state: 'pending_review', error: String(code || err?.message || err) });
      return reply.code(500).send({ error: code || 'llm_failed' });
    }
  });

  app.get('/review/report/:id', admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = await readBuild(id);
    if (!rec) return reply.code(404).send({ error: 'not_found' });
    const cfg = getConfig();
    const p = rec.llmReportPath
      ? path.join(cfg.BUNDLE_STORAGE_PATH, rec.llmReportPath)
      : path.join(cfg.BUNDLE_STORAGE_PATH, 'builds', id, 'llm.json');
    try {
      const txt = await fs.readFile(p, 'utf8');
      return JSON.parse(txt);
    } catch {
      return reply.code(404).send({ error: 'report_not_found' });
    }
  });

  app.get('/review/artifacts/:id', admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = await readBuild(id);
    if (!rec) return reply.code(404).send({ error: 'not_found' });
    const artifacts = await getBuildArtifacts(id);
    return artifacts;
  });

  app.get('/review/code/:id', async (req, reply) => {
    if (!req.headers.authorization) {
      const { token } = req.query as { token?: string };
      if (!token) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      try {
        const decoded = await getAuth().verifyIdToken(token);
        const claims: any = decoded;
        const role = claims.role || (claims.admin ? 'admin' : 'user');
        req.authUser = { uid: decoded.uid, role, claims: decoded };
      } catch (err) {
        req.log.debug({ err }, 'auth:token_invalid');
        return reply.code(401).send({ error: 'invalid auth token' });
      }
    }

    await requireRole('admin')(req, reply);
    if (reply.sent) return;

    // Allow clients that request ":id.tar.gz" or ":id.tgz" by stripping the suffix
    let { id } = req.params as { id: string } as any;
    if (typeof id === 'string') {
      id = id.replace(/\.(tar\.gz|tgz)$/i, '');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return reply.code(400).send({ error: 'invalid_id' });
    }
    const rec = await readBuild(id);
    if (!rec) return reply.code(404).send({ error: 'not_found' });
    const bucket = getBucket();
    const file = bucket.file(`builds/${id}/bundle.tar.gz`);
    const [exists] = await file.exists();
    if (exists) {
      reply.header('Content-Disposition', `attachment; filename="${id}.tar.gz"`);
      reply.type('application/gzip');
      return reply.send(file.createReadStream());
    }
    // Fallback: stream a tar.gz of the local bundle directory if present
    const cfg = (await import('../config.js')).getConfig();
    const localDir = path.join(cfg.BUNDLE_STORAGE_PATH, 'builds', id, 'bundle');
    try {
      await fs.access(localDir);
      const stream = tar.c({ gzip: true, cwd: localDir }, ['.']);
      reply.header('Content-Disposition', `attachment; filename="${id}.tar.gz"`);
      reply.type('application/gzip');
      return reply.send(stream as any);
    } catch {
      return reply.code(404).send({ error: 'bundle_not_found' });
    }
  });

  app.post('/review/approve/:id', admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = await readBuild(id);
    if (!rec) return reply.code(404).send({ error: 'not_found' });
    await updateBuild(id, { state: 'approved' });
    try {
      await publishBundle(id);
      await updateBuild(id, { state: 'published' });
      try {
        const apps = await readApps();
        const idx = apps.findIndex(
          (a) => a.pendingBuildId === id || a.buildId === id,
        );
        if (idx >= 0) {
          const now = Date.now();
          let app = apps[idx];
          if (app.pendingBuildId === id) {
            const { version, archivedVersions } = computeNextVersion(app, now);
            app.archivedVersions = archivedVersions;
            app.version = version;
            app.buildId = id;
            delete app.pendingBuildId;
            delete app.pendingVersion;
          }
          app.status = 'published';
          app.state = 'active';
          // Ensure published apps are visible in marketplace
          if ((app as any).visibility !== 'public') {
            (app as any).visibility = 'public';
          }
          app.playUrl = `/play/${app.id}/`;
          const ensured = ensureListingPreview(app as any);
          if (ensured.changed) {
            app = ensured.next as any;
          }
          app.publishedAt = now;
          app.updatedAt = now;
          apps[idx] = app;
          await writeApps(apps);
          // Ensure translations exist for supported locales after approval
          try {
            const { ensureListingTranslations } = await import('../lib/translate.js');
            await ensureListingTranslations(app as any, ['en', 'hr', 'de']);
          } catch {}
        }
      } catch (err) {
        req.log.error({ err, id }, 'listing_publish_update_failed');
      }
    } catch (err) {
      req.log.error({ err, id }, 'publish_failed');
      return reply.code(500).send({ error: 'publish_failed' });
    }
    try {
      // Best-effort admin notification
      await notifyAdmins(
        'App published',
        `Build ${id} has been approved and published by ${req.authUser?.uid || 'unknown admin'}.`
      );
    } catch {}
    req.log.info({ id, uid: req.authUser?.uid }, 'review_approved');
    return { ok: true };
  });

  app.post('/review/reject/:id', admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = await readBuild(id);
    if (!rec) return reply.code(404).send({ error: 'not_found' });
    const reason = (req.body as any)?.reason;
    await updateBuild(id, { state: 'rejected', ...(reason ? { error: reason } : {}) });
    try {
      const apps = await readApps();
      const idx = apps.findIndex(
        (a) => a.pendingBuildId === id || a.buildId === id || a.id === id,
      );
      if (idx >= 0) {
        const app = apps[idx];
        if (app.pendingBuildId === id) {
          delete app.pendingBuildId;
          delete app.pendingVersion;
        } else {
          app.status = 'rejected';
          app.state = 'inactive';
        }
        app.updatedAt = Date.now();
        await writeApps(apps);
      }
    } catch (err) {
      req.log.error({ err, id }, 'listing_reject_update_failed');
    }
    req.log.info({ id, uid: req.authUser?.uid, reason }, 'review_rejected');
    return { ok: true };
  });

  // Permissions policy (admin-only): persist simple allow flags per build
  app.get('/review/builds/:id/policy', admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = path.join(BUNDLE_ROOT, 'builds', id, 'policy.json');
    try {
      const raw = await fs.readFile(p, 'utf8');
      return JSON.parse(raw);
    } catch {
      return { camera: false, microphone: false, geolocation: false, clipboardRead: false, clipboardWrite: false };
    }
  });

  app.post('/review/builds/:id/policy', admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};
    const allowed = {
      camera: Boolean(body.camera),
      microphone: Boolean(body.microphone),
      geolocation: Boolean(body.geolocation),
      clipboardRead: Boolean(body.clipboardRead),
      clipboardWrite: Boolean(body.clipboardWrite),
    };
    const p = path.join(BUNDLE_ROOT, 'builds', id, 'policy.json');
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(allowed, null, 2));
    return { ok: true, policy: allowed };
  });

  // Permanently delete a build and its associated listing (admin only)
  app.post('/review/builds/:id/delete', admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const cfg = getConfig();

    // Remove listing by buildId/slug/id if present
    try {
      const apps = await readApps();
      const idx = apps.findIndex(
        (a: any) => a.buildId === id || a.slug === id || String(a.id) === id,
      );
      const removed = idx >= 0 ? apps[idx] : undefined;
      if (idx >= 0) {
        apps.splice(idx, 1);
        await writeApps(apps);
      }

      // Best-effort filesystem cleanup of build artifacts
      try {
        const dir = path.join(cfg.BUNDLE_STORAGE_PATH, 'builds', id);
        await fs.rm(dir, { recursive: true, force: true });
      } catch {}

      // Best-effort bucket cleanup
      try {
        const bucket = getBucket();
        await bucket.deleteFiles({ prefix: `builds/${id}/` });
      } catch {}

      return reply.send({ ok: true, removedListingId: removed?.id });
    } catch (err) {
      req.log.error({ err, id }, 'hard_delete_failed');
      return reply.code(500).send({ ok: false, error: 'delete_failed' });
    }
  });
}










