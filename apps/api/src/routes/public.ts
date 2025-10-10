import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getBucket } from '../storage.js';
import { readApps, type AppRecord, listEntitlements, hasAppSubscription, hasCreatorAllAccess } from '../db.js';
import { getBuildDir } from '../paths.js';
import { getConfig } from '../config.js';
import { createHmac } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';

export const __testing: Record<string, any> = {};

export default async function publicRoutes(app: FastifyInstance) {
  const encSeg = (s: string) => encodeURIComponent(String(s));
  const encRest = (p: string) =>
    String(p || '')
      .split('/')
      .filter(Boolean)
      .map((x) => encodeURIComponent(x))
      .join('/');
  // Proxy public assets from the storage bucket under /public/builds/*
  app.get('/public/builds/*', async (req, reply) => {
    const rest = (req.params as any)['*'] as string;
    // Normalize the captured path segment and ensure we address the intended
    // GCS object key under builds/<rest>. Avoid removing the first separator
    // inside "builds/…" which previously produced keys like "buildshhh/index.html".
    const cleanRest = (rest || '').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
    const key = `builds/${cleanRest}`;
    const bucket = getBucket();
    const file = bucket.file(key);
    const [exists] = await file.exists();
    if (!exists) return reply.code(404).send({ error: 'not_found' });
    try {
      const [meta] = await file.getMetadata();
      if (meta.contentType) reply.type(meta.contentType);
      if (meta.cacheControl) reply.header('Cache-Control', meta.cacheControl);
    } catch {}
    return reply.send(file.createReadStream());
  });

  // Lightweight player routes -------------------------------------------------
  // Redirect /play/:appId[/...rest] to the built bundle for the latest build
  app.get('/play/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    try {
      const apps = await readApps();
      const item = apps.find((a) => a.slug === id || String(a.id) === id) as
        | (AppRecord & { buildId?: string })
        | undefined;
      if (item?.buildId) {
        const mapped = item.buildId;
        // Prefer bucket-hosted public files if present
        try {
          const bucket = getBucket();
          const file = bucket.file(`builds/${mapped}/index.html`);
          const [exists] = await file.exists();
          if (exists) return reply.redirect(`/public/builds/${encSeg(mapped)}/index.html`, 302);
        } catch {}
        const dir = getBuildDir(mapped);
        // Prefer bundled output; fall back to root if missing
        try {
          await fs.access(path.join(dir, 'bundle', 'index.html'));
          return reply.redirect(`/builds/${encSeg(mapped)}/bundle/`, 302);
        } catch {}
        try {
          await fs.access(path.join(dir, 'index.html'));
          return reply.redirect(`/builds/${encSeg(mapped)}/`, 302);
        } catch {}
        return reply.redirect(`/review/builds/${encSeg(mapped)}/`, 302);
      }
      const byBuild = apps.find((a) => a.buildId === id);
      if (byBuild) return reply.redirect(`/play/${encSeg(byBuild.id)}/`, 302);
    } catch {}
    return reply.code(404).send({ error: 'not_found' });
  });
  app.get('/play/:id/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const restRaw = (req.params as any)['*'] as string;
    const rest = (restRaw || '').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
    const encRestSafe = encRest(rest);
    try {
      const apps = await readApps();
      const item = apps.find((a) => a.slug === id || String(a.id) === id) as
        | (AppRecord & { buildId?: string })
        | undefined;
      if (item?.buildId) {
        const mapped = item.buildId;
        // Prefer bucket-hosted assets when available
        try {
          const bucket = getBucket();
          const bundleFile = bucket.file(`builds/${mapped}/bundle/${rest}`);
          const [bundleExists] = await bundleFile.exists();
          if (bundleExists) {
            return reply.redirect(
              `/public/builds/${encSeg(mapped)}/bundle/${encRestSafe}`,
              302,
            );
          }
          const rootFile = bucket.file(`builds/${mapped}/${rest}`);
          const [rootExists] = await rootFile.exists();
          if (rootExists) {
            return reply.redirect(
              `/public/builds/${encSeg(mapped)}/${encRestSafe}`,
              302,
            );
          }
        } catch {}
        const dir = getBuildDir(mapped);
        try {
          await fs.access(path.join(dir, 'bundle', rest));
          return reply.redirect(
            `/builds/${encSeg(mapped)}/bundle/${encRestSafe}`,
            302,
          );
        } catch {}
        try {
          await fs.access(path.join(dir, rest));
          return reply.redirect(
            `/builds/${encSeg(mapped)}/${encRestSafe}`,
            302,
          );
        } catch {}
        return reply.redirect(
          `/review/builds/${encSeg(mapped)}/${encRestSafe}`,
          302,
        );
      }
      const byBuild = apps.find((a) => a.buildId === id);
      if (byBuild) {
        return reply.redirect(
          `/play/${encSeg(byBuild.id)}/${encRestSafe}`,
          302,
        );
      }
    } catch {}
    return reply.code(404).send({ error: 'not_found' });
  });

  function readTrialFromSignedCookie(req: FastifyRequest): { uid: string; appId?: string | number } | undefined {
    try {
      const raw = (req as any).cookies?.['cx_trial'];
      if (!raw) return undefined;
      const cfg = getConfig();
      const decoded = Buffer.from(raw, 'base64url').toString('utf8');
      const idx = decoded.lastIndexOf('.');
      if (idx <= 0) return undefined;
      const payload = decoded.slice(0, idx);
      const sig = decoded.slice(idx + 1);
      const expect = createHmac('sha256', cfg.IP_SALT).update(payload).digest('hex');
      if (expect !== sig) return undefined;
      const data = JSON.parse(payload);
      if (typeof data?.uid !== 'string') return undefined;
      if (typeof data?.exp === 'number' && Date.now() > data.exp) return undefined;
      return { uid: data.uid as string, appId: data.appId };
    } catch {
      return undefined;
    }
  }

  function readOwnerFromSignedCookie(req: FastifyRequest): string | undefined {
    try {
      const raw = (req as any).cookies?.['cx_owner'];
      if (!raw) return undefined;
      const cfg = getConfig();
      const decoded = Buffer.from(raw, 'base64url').toString('utf8');
      const idx = decoded.lastIndexOf('.');
      if (idx <= 0) return undefined;
      const payload = decoded.slice(0, idx);
      const sig = decoded.slice(idx + 1);
      const expect = createHmac('sha256', cfg.IP_SALT).update(payload).digest('hex');
      if (expect !== sig) return undefined;
      const data = JSON.parse(payload);
      if (typeof data?.uid !== 'string') return undefined;
      return data.uid as string;
    } catch {
      return undefined;
    }
  }

  async function ensureAuthUid(req: FastifyRequest) {
    if (req.authUser?.uid) return;
    let token: string | undefined;

    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string') {
      const m = authHeader.match(/^Bearer\s+(.+)$/i);
      if (m) token = m[1];
    }

    if (token) {
      try {
        const decoded = await getAuth().verifyIdToken(token);
        const claims: any = decoded;
        const role = claims.role || (claims.admin ? 'admin' : 'user');
        req.authUser = { uid: decoded.uid, role, claims: decoded };
        return;
      } catch {}
    }

    const ownerUid = readOwnerFromSignedCookie(req);
    if (ownerUid) {
      req.authUser = { uid: ownerUid, role: 'user', claims: { uid: ownerUid } as any };
      return;
    }

    const q = req.query as any;
    token = typeof q.token === 'string' ? (q.token as string) : undefined;
    if (token) {
      try {
        const decoded = await getAuth().verifyIdToken(token);
        const claims: any = decoded;
        const role = claims.role || (claims.admin ? 'admin' : 'user');
        req.authUser = { uid: decoded.uid, role, claims: decoded };
      } catch {}
    }
  }

  async function isAllowedToPlay(req: FastifyRequest, item: AppRecord & { buildId?: string }) {
    const price = (item as any).price as number | undefined;
    const ownerUid = item.author?.uid || (item as any).ownerUid;
    const trial = readTrialFromSignedCookie(req);
    const ownerCookie = readOwnerFromSignedCookie(req);
    const uid =
      (req.authUser?.uid as string | undefined) || ownerCookie || trial?.uid || undefined;
    const isAdmin = req.authUser?.role === 'admin' || (req.authUser as any)?.claims?.admin === true;
    const isOwner = Boolean(uid && ownerUid && uid === ownerUid);
    if (!price || price <= 0) return true;
    if (isOwner || isAdmin) return true;
    if (!uid) return false;
    try {
      const hasAppSub = await hasAppSubscription(uid, item.id);
      const hasCreatorAll = ownerUid ? await hasCreatorAllAccess(uid, ownerUid) : false;
      const ents = await listEntitlements(uid);
      const now = Date.now();
      let hasTrial = ents.some((e) => {
        if (e.feature !== 'app-trial') return false;
        const data = (e.data || {}) as any;
        // Accept either numeric appId or legacy slug string
        if (!(String(data.appId) === String(item.id) || data.appId === item.slug)) return false;
        const exp = typeof data.expiresAt === 'string' ? Date.parse(data.expiresAt) : (typeof data.expiresAt === 'number' ? data.expiresAt : undefined);
        return (e.active !== false) && (!exp || exp > now);
      });
      // Fallback: if signed trial cookie exists and matches this app, allow
      if (!hasTrial && trial?.appId != null) {
        if (String(trial.appId) === String(item.id) || trial.appId === item.slug) {
          hasTrial = true;
        }
      }
      return hasAppSub || hasCreatorAll || hasTrial;
    } catch {
      return false;
    }
  }

  __testing.isAllowedToPlay = isAllowedToPlay;

  // Public app route by slug for published listings
  app.get('/app/:slug', async (req: FastifyRequest, reply: FastifyReply) => {
    const { slug } = req.params as { slug: string };
    const apps = await readApps();
    const item = apps.find((a) => a.slug === slug || String(a.id) === slug) as
      | (AppRecord & { buildId?: string; pendingBuildId?: string })
      | undefined;

    const buildId = item?.pendingBuildId || item?.buildId;

    if (!item || !buildId) return reply.code(404).send({ error: 'not_found' });
    const isPublic = item.status === 'published' || item.state === 'active';
    if (!isPublic) return reply.code(404).send({ error: 'not_found' });
    await ensureAuthUid(req);
    const canPlay = await isAllowedToPlay(req, item);
    if (!canPlay) {
      const lang = String((req.headers['accept-language'] || '')).toLowerCase();
      const starts = (p: string) => lang.startsWith(p);
      const locale = starts('hr') ? 'hr' : starts('de') ? 'de' : 'en';
      const t = (key: 'title'|'lead'|'cta'|'home') => {
        if (locale === 'hr') {
          return key === 'title' ? 'Potrebna je potvrda za probnu verziju'
            : key === 'lead' ? 'Ovo je probna (trial) verzija dostupna isključivo uz važeći kod.'
            : key === 'cta' ? 'Pročitaj kako do koda (FAQ)'
            : 'Nazad na naslovnicu';
        }
        if (locale === 'de') {
          return key === 'title' ? 'Bestätigung für Testversion erforderlich'
            : key === 'lead' ? 'Dies ist eine Testversion (Trial), die nur mit gültigem Code verfügbar ist.'
            : key === 'cta' ? 'Wie erhalte ich den Code? (FAQ)'
            : 'Zur Startseite';
        }
        return key === 'title' ? 'Trial access required'
          : key === 'lead' ? 'This is a trial version available only with a valid code.'
          : key === 'cta' ? 'Learn how to get a code (FAQ)'
          : 'Back to Home';
      };
      const wantsHtml = String(req.headers['accept'] || '').includes('text/html');
      if (wantsHtml) {
        const html = `<!DOCTYPE html><html lang="${locale}"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${t('title')}</title>
<style>
  :root{--fg:#111827;--muted:#6b7280;--bg:#f9fafb;--card:#ffffff;--pri:#10b981;}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,'Helvetica Neue',Arial,'Noto Sans',sans-serif;color:var(--fg)}
  .wrap{min-height:100vh;display:grid;place-items:center;padding:24px}
  .card{max-width:720px;background:var(--card);border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,0.06);padding:28px}
  h1{margin:0 0 8px 0;font-size:22px}
  p{margin:0 0 18px 0;color:var(--muted);line-height:1.6}
  .row{display:flex;gap:12px;flex-wrap:wrap}
  a.btn{display:inline-block;padding:10px 14px;border-radius:10px;text-decoration:none;color:white;background:var(--pri)}
  a.link{color:#2563eb;text-decoration:none}
  a.link:hover{text-decoration:underline}
</style></head><body><div class="wrap"><div class="card">
<h1>${t('title')}</h1>
<p>${t('lead')}</p>
<div class="row">
  <a class="btn" href="/faq">${t('cta')}</a>
  <a class="link" href="/">${t('home')}</a>
 </div>
</div></div></body></html>`;
        reply.type('text/html; charset=utf-8');
        return reply.code(403).send(html);
      }
      const message = t('lead');
      return reply.code(403).send({ error: 'payment_required', code: 'trial_code_required', message, locale });
    }
    // Prefer bucket-hosted public files if present
    try {
      const bucket = getBucket();
      const file = bucket.file(`builds/${buildId}/index.html`);
      const [exists] = await file.exists();
      if (exists) return reply.redirect(`/public/builds/${encSeg(buildId)}/index.html`, 302);
    } catch {}
    const dir = getBuildDir(buildId);
    try {
      await fs.access(path.join(dir, 'bundle', 'index.html'));
      return reply.redirect(`/builds/${encSeg(buildId)}/bundle/`, 302);
    } catch {}
    try {
      await fs.access(path.join(dir, 'index.html'));
      return reply.redirect(`/builds/${encSeg(buildId)}/`, 302);
    } catch {}
    return reply.redirect(`/review/builds/${encSeg(buildId)}/`, 302);
  });
  app.get('/app/:slug/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const { slug } = req.params as { slug: string };
    const rest = (req.params as any)['*'] as string;
    const apps = await readApps();
    const item = apps.find((a) => a.slug === slug || String(a.id) === slug) as
      | (AppRecord & { buildId?: string; pendingBuildId?: string })
      | undefined;

    const buildId = item?.pendingBuildId || item?.buildId;

    if (!item || !buildId) return reply.code(404).send({ error: 'not_found' });
    const isPublic = item.status === 'published' || item.state === 'active';
    if (!isPublic) return reply.code(404).send({ error: 'not_found' });
    await ensureAuthUid(req);
    const canPlay = await isAllowedToPlay(req, item);
    if (!canPlay) {
      const lang = String((req.headers['accept-language'] || '')).toLowerCase();
      const starts = (p: string) => lang.startsWith(p);
      const locale = starts('hr') ? 'hr' : starts('de') ? 'de' : 'en';
      const t = (key: 'title'|'lead'|'cta'|'home') => {
        if (locale === 'hr') {
          return key === 'title' ? 'Potrebna je potvrda za probnu verziju'
            : key === 'lead' ? 'Ovo je probna (trial) verzija dostupna isključivo uz važeći kod.'
            : key === 'cta' ? 'Pročitaj kako do koda (FAQ)'
            : 'Nazad na naslovnicu';
        }
        if (locale === 'de') {
          return key === 'title' ? 'Bestätigung für Testversion erforderlich'
            : key === 'lead' ? 'Dies ist eine Testversion (Trial), die nur mit gültigem Code verfügbar ist.'
            : key === 'cta' ? 'Wie erhalte ich den Code? (FAQ)'
            : 'Zur Startseite';
        }
        return key === 'title' ? 'Trial access required'
          : key === 'lead' ? 'This is a trial version available only with a valid code.'
          : key === 'cta' ? 'Learn how to get a code (FAQ)'
          : 'Back to Home';
      };
      const wantsHtml = String(req.headers['accept'] || '').includes('text/html');
      if (wantsHtml) {
        const html = `<!DOCTYPE html><html lang="${locale}"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${t('title')}</title>
<style>
  :root{--fg:#111827;--muted:#6b7280;--bg:#f9fafb;--card:#ffffff;--pri:#10b981;}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,'Helvetica Neue',Arial,'Noto Sans',sans-serif;color:var(--fg)}
  .wrap{min-height:100vh;display:grid;place-items:center;padding:24px}
  .card{max-width:720px;background:var(--card);border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,0.06);padding:28px}
  h1{margin:0 0 8px 0;font-size:22px}
  p{margin:0 0 18px 0;color:var(--muted);line-height:1.6}
  .row{display:flex;gap:12px;flex-wrap:wrap}
  a.btn{display:inline-block;padding:10px 14px;border-radius:10px;text-decoration:none;color:white;background:var(--pri)}
  a.link{color:#2563eb;text-decoration:none}
  a.link:hover{text-decoration:underline}
 </style></head><body><div class="wrap"><div class="card">
<h1>${t('title')}</h1>
<p>${t('lead')}</p>
<div class="row">
  <a class="btn" href="/faq">${t('cta')}</a>
  <a class="link" href="/">${t('home')}</a>
 </div>
</div></div></body></html>`;
        reply.type('text/html; charset=utf-8');
        return reply.code(403).send(html);
      }
      const message = t('lead');
      return reply.code(403).send({ error: 'payment_required', code: 'trial_code_required', message, locale });
    }
    // Prefer bucket-hosted public files if present
    try {
      const bucket = getBucket();
      const file = bucket.file(`builds/${buildId}/index.html`);
      const [exists] = await file.exists();
      if (exists) return reply.redirect(`/public/builds/${encSeg(buildId)}/${encRest(rest)}`, 302);
    } catch {}
    const dir = getBuildDir(buildId);
    try {
      await fs.access(path.join(dir, 'bundle', 'index.html'));
      return reply.redirect(`/builds/${encSeg(buildId)}/bundle/${encRest(rest)}`, 302);
    } catch {}
    try {
      await fs.access(path.join(dir, 'index.html'));
      return reply.redirect(`/builds/${encSeg(buildId)}/${encRest(rest)}`, 302);
    } catch {}
    return reply.redirect(`/review/builds/${encSeg(buildId)}/${encRest(rest)}`, 302);
  });
}
