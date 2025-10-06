import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as esbuild from 'esbuild';
import { createJob, isJobActive } from '../buildQueue.js';
import { notifyAdmins } from '../notifier.js';
import { getBuildDir } from '../paths.js';
import { readApps, writeApps, type AppRecord, listEntitlements } from '../db.js';
import { getConfig } from '../config.js';
import { computeNextVersion } from '../lib/versioning.js';

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

  interface PublishPayload {
  id: string;
  title?: string;
  description?: string;
  translations?: Record<string, { title?: string; description?: string }>;
  author?: { uid: string; handle?: string };
  capabilities?: {
    permissions?: {
      camera?: boolean;
      microphone?: boolean;
      webgl?: boolean;
      fileDownload?: boolean;
    };
    network?: {
      access?: string;
      mediaDomains?: string[];
      domains?: string[];
    };
  };
  inlineCode: string;
  visibility?: string;
}

  export default async function publishRoutes(app: FastifyInstance) {
    const handler = async (req: FastifyRequest, reply: any) => {
    req.log.info('publish:received');
    const uid = req.authUser?.uid;
    if (!uid) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }

    const body = req.body as PublishPayload | undefined;
    if (!body || !body.inlineCode) {
      return reply.code(400).send({ ok: false, error: 'invalid payload' });
    }

    // Accept numeric IDs or slugs; normalize to string for comparisons
    const appId = (body as any).id != null ? String((body as any).id) : undefined;
    const buildId = randomUUID();
    if (isJobActive(buildId)) {
      return reply.code(409).send({ ok: false, error: 'build_in_progress' });
    }
    body.author = body.author || { uid };

    const apps = await readApps();
    const owned = apps.filter(
      (a) => a.author?.uid === uid || (a as any).ownerUid === uid,
    );
    // When updating, permit matching by id or slug (and tolerate numeric id)
    const idxOwned = appId
      ? owned.findIndex((a) => a.id === appId || a.slug === appId)
      : -1;
    const existingOwned = idxOwned >= 0 ? owned[idxOwned] : undefined;
    const isAdmin = (req as any).authUser?.role === 'admin' || (req as any).authUser?.claims?.admin === true;
    if (!existingOwned && !isAdmin) {
      const ents = await listEntitlements(uid);
      const gold = ents.some(
        (e) => e.feature === 'isGold' && e.active !== false,
      );
      const cfg = getConfig();
      const limit = gold ? cfg.GOLD_MAX_APPS_PER_USER : cfg.MAX_APPS_PER_USER;
      const activeOwned = owned.filter((a) => a.state !== 'inactive');
      if (activeOwned.length >= limit) {
        return reply
          .code(403)
          .send({
            ok: false,
            error: 'max_apps',
            message: `Dosegli ste maksimalan broj aplikacija (${limit})`,
          });
      }
    }

    // Quick guard: block SES/lockdown in browser inline code to avoid white screens
    const code = String(body.inlineCode || '');
    const sesRe = /(\blockdown\s*\(|\brequire\s*\(\s*['\"]ses['\"]\s*\)|\bfrom\s+['\"]ses['\"]|import\s*\(\s*['\"]ses['\"]\s*\))/;
    if (sesRe.test(code)) {
      req.log.info({ reason: 'ses_lockdown' }, 'publish:blocked');
      return reply
        .code(400)
        .send({ ok: false, error: 'ses_lockdown', code: 'ses_lockdown', message: 'SES/lockdown is not supported in the browser. Remove it or guard for server-only.' });
    }

    try {
      const dir = getBuildDir(buildId);
      await fs.mkdir(dir, { recursive: true });

      // Simple check for HTML file
      if (body.inlineCode.trim().toLowerCase().startsWith('<!doctype html>')) {
        await fs.writeFile(path.join(dir, 'index.html'), body.inlineCode, 'utf8');
        // Create an empty app.js so the rest of the pipeline doesn't break
        await fs.writeFile(path.join(dir, 'app.js'), '', 'utf8');
      } else {
        const result = await esbuild.transform(body.inlineCode, {
          loader: 'tsx',
          format: 'esm',
          jsx: 'automatic',
          jsxDev: process.env.NODE_ENV !== 'production',
        });
        await fs.writeFile(path.join(dir, 'app.js'), result.code, 'utf8');
        await fs.writeFile(
          path.join(dir, 'index.html'),
          '<!doctype html><div id="root"></div>',
          'utf8',
        );
      }
    } catch (err) {
      req.log.error({ err }, 'publish:build_failed');
      return reply.code(400).send({ ok: false, error: 'build_failed' });
    }

    await createJob(buildId, req.log);
    let listingId: number | undefined;
    try {
      const now = Date.now();
      const numericIds = apps
        .map((a) => Number(a.id))
        .filter((n) => !Number.isNaN(n));
      // Find existing by id or slug; avoid false negatives when id comes as number
      const idx = appId ? apps.findIndex((a) => a.id === appId || a.slug === appId) : -1;
      const existing = idx >= 0 ? apps[idx] : undefined;
      listingId = existing
        ? Number(existing.id)
        : (numericIds.length ? Math.max(...numericIds) : 0) + 1;
      const existingSlug = existing?.slug;
      const baseSlug = slugify(body.title || '') || `app-${listingId}`;
      let slug = existingSlug || baseSlug;
      if (!existingSlug) {
        let cnt = 1;
        while (apps.some((a) => a.slug === slug)) {
          slug = `${baseSlug}-${cnt++}`;
        }
      }

      const { version, archivedVersions } = computeNextVersion(existing, now);
      const sanitizeTranslations = (input?: Record<string, { title?: string; description?: string }>) => {
        const out: Record<string, { title?: string; description?: string }> = {};
        for (const [loc, obj] of Object.entries(input || {})) {
          const l = String(loc).toLowerCase().slice(0, 2);
          if (!['en','hr','de'].includes(l)) continue;
          const title = (obj?.title ?? '').toString().trim();
          const description = (obj?.description ?? '').toString().trim();
          if (!title && !description) continue;
          out[l] = {};
          if (title) out[l].title = title;
          if (description) out[l].description = description;
        }
        return out;
      };

      if (existing) {
        const base: AppRecord = {
          ...existing,
          slug,
          title: body.title || existing.title || '',
          description: body.description || existing.description || '',
          tags: existing.tags ?? [],
          visibility: (body.visibility as any) || existing.visibility,
          accessMode: existing.accessMode,
          author: body.author,
          capabilities: body.capabilities as any,
          updatedAt: now,
          status: existing.status,
          state: existing.state ?? 'draft',
          playUrl: existing.playUrl,
          likesCount: existing.likesCount,
          playsCount: existing.playsCount,
          reports: existing.reports,
          domainsSeen: existing.domainsSeen,
          archivedVersions: existing.archivedVersions,
          pendingBuildId: buildId,
          pendingVersion: version,
        };
        const provided = sanitizeTranslations(body.translations);
        if (Object.keys(provided).length) {
          // Merge over existing translations
          const current = (existing as any).translations || {};
          base["translations" as any] = { ...current } as any;
          for (const [k, v] of Object.entries(provided)) {
            (base as any).translations[k] = { ...(base as any).translations[k], ...v };
          }
        }
        apps[idx] = base;
      } else {
        const base: AppRecord = {
          id: String(listingId),
          slug,
          buildId,
          title: body.title || '',
          description: body.description || '',
          tags: [],
          visibility: (body.visibility as any) || 'public',
          accessMode: 'public',
          author: body.author,
          capabilities: body.capabilities as any,
          createdAt: now,
          updatedAt: now,
          status: 'pending-review',
          state: 'draft',
          playUrl: `/play/${listingId}/`,
          likesCount: 0,
          playsCount: 0,
          reports: [],
          domainsSeen: [],
          version,
          archivedVersions,
        };
        const provided = sanitizeTranslations(body.translations);
        if (Object.keys(provided).length) (base as any).translations = provided as any;
        apps.push(base);
      }
      await writeApps(apps);
      req.log.info({ buildId, listingId, slug }, 'publish:created');
      // Best‑effort admin notification on submission (with richer context)
      try {
        const cfg = getConfig();
        const title = (body.title || '').trim() || `App ${listingId}`;
        const authorUid = body.author?.uid || uid;
        const authorHandle = (body.author as any)?.handle || undefined;
        const claims: any = (req as any).authUser?.claims || {};
        const displayName = claims.name || claims.displayName || undefined;
        const email = claims.email || undefined;
        const prettyAuthor = [displayName, authorHandle]
          .filter(Boolean)
          .join(' · ');
        const subject = `Novo slanje: ${title}${prettyAuthor ? ` — ${prettyAuthor}` : ''}`;
        const lines: string[] = [];
        lines.push(`Naslov: ${title}`);
        lines.push(`ID: ${listingId}`);
        lines.push(`Slug: ${slug}`);
        lines.push(`Build ID: ${buildId}`);
        lines.push(`Autor UID: ${authorUid}`);
        if (displayName) lines.push(`Autor: ${displayName}`);
        if (authorHandle) lines.push(`Korisničko ime: @${authorHandle}`);
        if (email) lines.push(`E-mail: ${email}`);
        const desc = String(body.description || '').trim();
        if (desc) {
          const short = desc.length > 300 ? desc.slice(0, 300) + '…' : desc;
          lines.push('');
          lines.push('Opis:');
          lines.push(short);
        }
        lines.push('');
        const webBase = (cfg.WEB_BASE || 'http://localhost:3000').replace(/\/$/, '');
        const apiBase = (cfg.PUBLIC_BASE || `http://127.0.0.1:${cfg.PORT}`).replace(/\/$/, '');
        lines.push('Linkovi:');
        lines.push(`• Admin pregled: ${webBase}/admin/`);
        lines.push(`• Status builda: ${apiBase}/build/${buildId}/status`);
        lines.push(`• Događaji builda (SSE): ${apiBase}/build/${buildId}/events`);
        await notifyAdmins(subject, lines.join('\n'));
      } catch {}
      // Best-effort background translation for core locales
      try {
        const { ensureListingTranslations } = await import('../lib/translate.js');
        const created = apps.find((a) => a.id === String(listingId));
        if (created) {
          // Fire and forget
          void ensureListingTranslations(created as any, ['en', 'hr', 'de']);
        }
      } catch {}
      return reply.code(202).send({ ok: true, buildId, listingId, slug });
    } catch (err) {
      req.log.error({ err }, 'publish:listing_write_failed');
      return reply
        .code(500)
        .send({ ok: false, error: 'listing_write_failed' });
    }
  };

  // Accept both with and without trailing slash (Next.js dev adds it by default)
  app.post('/publish', handler);
  app.post('/publish/', handler);
  app.post('/createx/publish', handler);
  app.post('/createx/publish/', handler);
}
