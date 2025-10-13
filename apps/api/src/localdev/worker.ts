import { Worker, Job } from 'bullmq';
import path from 'node:path';
import { promises as fsp, createWriteStream } from 'node:fs';
import { devBuildQueue, getConnection, type LocalDevOwner } from './queue.js';
import { getLocalDevConfig } from './env.js';
import { unzipTo } from './unzip.js';
import { runBuild } from './build.js';
import { deployDist } from './deploy.js';
import { sha256File } from './utils.js';
import { rmrf } from './fs.js';
import * as tar from 'tar';
import { readApps, writeApps } from '../db.js';
import { getConfig } from '../config.js';
import { computeNextVersion } from '../lib/versioning.js';
import { initBuild, updateBuild } from '../models/Build.js';
import type { AppRecord } from '../types.js';
import { writeArtifact } from '../utils/artifacts.js';
import { transformHtmlLite } from '../lib/csp.js';
import { detectRoomsStorageKeys } from '../lib/roomsBridge.js';

type BundleMetadata = {
  name?: string;
  description?: string;
  tags?: string[];
  translations?: Record<string, { title?: string; description?: string }>;
  visibility?: 'public' | 'unlisted';
};

type JobData = { appId: string; zipPath: string; allowScripts?: boolean; owner?: LocalDevOwner };

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function sanitizeTranslations(
  input?: Record<string, { title?: string; description?: string }>,
): Record<string, { title?: string; description?: string }> {
  const out: Record<string, { title?: string; description?: string }> = {};
  for (const [loc, obj] of Object.entries(input || {})) {
    const l = String(loc).toLowerCase().slice(0, 2);
    if (!['en', 'hr', 'de'].includes(l)) continue;
    const title = (obj?.title ?? '').toString().trim();
    const description = (obj?.description ?? '').toString().trim();
    if (!title && !description) continue;
    out[l] = {};
    if (title) out[l].title = title;
    if (description) out[l].description = description;
  }
  return out;
}

async function readBundleMetadata(projectDir: string): Promise<BundleMetadata> {
  const result: BundleMetadata = {};
  const readJson = async (p: string) => {
    try {
      const raw = await fsp.readFile(p, 'utf8');
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  };

  const metadataCandidates = [
    path.join(projectDir, 'metadata.json'),
    path.join(projectDir, 'dist', 'metadata.json'),
    path.join(projectDir, 'public', 'metadata.json'),
  ];

  let rawMetadata: any;
  for (const candidate of metadataCandidates) {
    if (await pathExists(candidate)) {
      rawMetadata = await readJson(candidate);
      if (rawMetadata && typeof rawMetadata === 'object') break;
    }
  }

  const pickString = (value: unknown) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  };

  if (rawMetadata && typeof rawMetadata === 'object') {
    const name = pickString(rawMetadata.name ?? rawMetadata.title);
    if (name) result.name = name;
    const description = pickString(rawMetadata.description);
    if (description) result.description = description;
    if (Array.isArray(rawMetadata.tags)) {
      const tags = rawMetadata.tags
        .map((tag: unknown) => pickString(tag))
        .filter((tag): tag is string => !!tag);
      if (tags.length) result.tags = tags;
    }
    if (
      rawMetadata.translations &&
      typeof rawMetadata.translations === 'object' &&
      !Array.isArray(rawMetadata.translations)
    ) {
      const translations: Record<string, { title?: string; description?: string }> = {};
      for (const [locale, value] of Object.entries(rawMetadata.translations)) {
        if (!value || typeof value !== 'object') continue;
        const title = pickString((value as any).title);
        const description = pickString((value as any).description);
        if (!title && !description) continue;
        translations[locale] = {};
        if (title) translations[locale].title = title;
        if (description) translations[locale].description = description;
      }
      if (Object.keys(translations).length) {
        result.translations = translations;
      }
    }
    const visibility = pickString(rawMetadata.visibility);
    if (visibility === 'unlisted' || visibility === 'public') {
      result.visibility = visibility;
    }
  }

  if (!result.name || !result.description || !result.tags?.length) {
    const pkgPath = path.join(projectDir, 'package.json');
    if (await pathExists(pkgPath)) {
      const pkgJson = await readJson(pkgPath);
      if (pkgJson && typeof pkgJson === 'object') {
        if (!result.name) {
          const pkgName =
            pickString(pkgJson.displayName) ||
            pickString(pkgJson.name);
          if (pkgName) result.name = pkgName;
        }
        if (!result.description) {
          const pkgDescription = pickString(pkgJson.description);
          if (pkgDescription) result.description = pkgDescription;
        }
        if (!result.tags?.length && Array.isArray(pkgJson.keywords)) {
          const tags = pkgJson.keywords
            .map((kw: unknown) => pickString(kw))
            .filter((kw): kw is string => !!kw);
          if (tags.length) result.tags = tags;
        }
      }
    }
  }

  if (!result.name) {
    result.name = path.basename(projectDir);
  }
  return result;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await fsp.copyFile(srcPath, destPath);
    }
  }
}

async function findFirstJsFile(dir: string, base: string = dir): Promise<string | undefined> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.js')) {
      return path.relative(base, abs).replace(/\\/g, '/');
    }
    if (entry.isDirectory()) {
      const found = await findFirstJsFile(abs, base);
      if (found) return found;
    }
  }
  return undefined;
}

async function ensureAppJs(bundleDir: string, log: (s: string) => void): Promise<void> {
  const appJsPath = path.join(bundleDir, 'app.js');
  if (await pathExists(appJsPath)) return;
  try {
    const indexPath = path.join(bundleDir, 'index.html');
    const html = await fsp.readFile(indexPath, 'utf8');
    const match = html.match(/<script[^>]*type\s*=\s*['"]module['"][^>]*src\s*=\s*['"]([^'"]+)['"]/i);
    let entry = match ? match[1] : undefined;
    if (entry) {
      entry = entry.replace(/^\.\//, '').replace(/^\//, '');
      const content = `import './${entry.replace(/\\/g, '/')}';\n`;
      await fsp.writeFile(appJsPath, content, 'utf8');
      return;
    }
    const fallback = await findFirstJsFile(bundleDir);
    if (fallback) {
      const content = `import './${fallback}';\n`;
      await fsp.writeFile(appJsPath, content, 'utf8');
      return;
    }
    log('[warn] Unable to determine bundle entry point; app.js not created');
  } catch (err: any) {
    log(`[warn] app.js generation failed: ${err?.message || err}`);
  }
}

async function syncBundleDirectory(distPath: string, buildId: string, log: (s: string) => void): Promise<string> {
  const cfg = getConfig();
  const buildRoot = path.join(cfg.BUNDLE_STORAGE_PATH, 'builds', buildId);
  const bundleDir = path.join(buildRoot, 'bundle');
  await fsp.rm(bundleDir, { recursive: true, force: true });
  await fsp.mkdir(bundleDir, { recursive: true });
  try {
    const cp: any = (fsp as any).cp;
    if (typeof cp === 'function') {
      await cp(distPath, bundleDir, { recursive: true });
    } else {
      await copyDir(distPath, bundleDir);
    }
  } catch (err: any) {
    log(`[warn] fs.cp failed (${err?.message || err}); falling back to manual copy`);
    await copyDir(distPath, bundleDir);
  }
  await ensureAppJs(bundleDir, log);
  return bundleDir;
}


async function rewriteIndexHtml(bundleDir: string, log: (s: string) => void): Promise<void> {
  const indexPath = path.join(bundleDir, 'index.html');
  if (!(await pathExists(indexPath))) return;
  try {
    let html = await fsp.readFile(indexPath, 'utf8');
    const rewritten = html
      .replace(/(src|href)\s*=\s*(['"])\/(?!\/)/gi, '$1=$2./')
      .replace(/url\(\s*(['"])\/(?!\/)/gi, 'url($1./');
    if (rewritten !== html) {
      await fsp.writeFile(indexPath, rewritten, 'utf8');
      html = rewritten;
    }

      const cfg = getConfig();
      if (cfg.PUBLISH_CSP_AUTOFIX !== false) {
        const roomsAllowlist = Array.isArray(cfg.THESARA_ROOMS_KEYS)
          ? cfg.THESARA_ROOMS_KEYS
          : [];
        let detectedRoomsKeys: string[] = [];
        if (cfg.PUBLISH_ROOMS_AUTOBRIDGE && roomsAllowlist.length) {
          detectedRoomsKeys = await detectRoomsStorageKeys(bundleDir, roomsAllowlist, log);
          if (detectedRoomsKeys.length) {
            log(`[rooms-bridge] detected storage keys: ${detectedRoomsKeys.join(', ')}`);
          } else {
            log('[rooms-bridge] no matching storage keys detected');
          }
        }
        const report = await transformHtmlLite({
          indexPath,
          rootDir: bundleDir,
          bundleModuleScripts: true,
          vendorExternalResources: true,
          vendorMaxBytes: cfg.PUBLISH_VENDOR_MAX_DOWNLOAD_BYTES,
          vendorTimeoutMs: cfg.PUBLISH_VENDOR_TIMEOUT_MS,
          failOnInlineHandlers: cfg.PUBLISH_CSP_AUTOFIX_STRICT,
          autoBridgeRooms: !!cfg.PUBLISH_ROOMS_AUTOBRIDGE && detectedRoomsKeys.length > 0,
          roomsStorageKeys: detectedRoomsKeys,
          apiBase: cfg.PUBLIC_BASE,
          log: (msg) => log(msg),
        });
      if (report.baseRemoved) {
        log('[csp] removed <base> tag(s) from index.html');
      }
      if (report.inlineScripts.length) {
        log(
          `[csp] extracted ${report.inlineScripts.length}/${report.totalInlineScripts} inline <script> block(s)`,
        );
        for (const item of report.inlineScripts) {
          log(`[csp] -> ${item.fileName} (${item.size} bytes)`);
        }
      }
      if (report.vendored.length) {
        log(`[csp] vendored ${report.vendored.length} external resource(s)`);
        for (const res of report.vendored) {
          log(`[csp] vendor ${res.type}: ${res.url} -> ${res.localPath} (${res.size} bytes)`);
        }
      }
      if (report.inlineStyles.length) {
        log(`[csp] inline style occurrences detected (${report.inlineStyles.length})`);
      }
      if (report.moduleBundle.created) {
        log(`[csp] bundled ${report.moduleBundle.inputs} module script(s) into app.js`);
      }
      if (report.inlineEventHandlers.length) {
        log(
          `[csp] inline event handlers detected (${report.inlineEventHandlers.length}) - consider removing to satisfy strict CSP`,
        );
      }
      if (report.warnings.length) {
        report.warnings.forEach((w) => log(`[csp] warn: ${w}`));
      }
    } else {
      log('[csp] auto-fix disabled (PUBLISH_CSP_AUTOFIX=0)');
    }
  } catch (err: any) {
    log(`[warn] index.html rewrite failed: ${err?.message || err}`);
  }
}

async function detectExternalDomains(bundleDir: string, log: (s: string) => void): Promise<string[]> {
  const out = new Set<string>();
  try {
    const indexPath = path.join(bundleDir, 'index.html');
    if (await pathExists(indexPath)) {
      const html = await fsp.readFile(indexPath, 'utf8');
      const urlRe = /(src|href)\s*=\s*['"](https?:[^'"\s>]+)['"]/gi;
      let m: RegExpExecArray | null;
      while ((m = urlRe.exec(html))) {
        try {
          const origin = new URL(m[2]).origin;
          out.add(origin);
        } catch {}
      }
    }
  } catch (err: any) {
    log(`[warn] cdn detection failed: ${err?.message || err}`);
  }
  return Array.from(out);
}

async function ensureManifest(
  buildId: string,
  metadata: BundleMetadata,
  log: (s: string) => void,
  domains: string[] = [],
): Promise<void> {
  const cfg = getConfig();
  const buildDir = path.join(cfg.BUNDLE_STORAGE_PATH, 'builds', buildId, 'build');
  await fsp.mkdir(buildDir, { recursive: true });
  const manifest = {
    id: buildId,
    entry: 'app.js',
    name: metadata.name || buildId,
    description: metadata.description || '',
    networkPolicy: domains.length ? 'OPEN_NET' : 'NO_NET',
    networkDomains: domains,
  } as Record<string, any>;
  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestPath = path.join(buildDir, 'manifest_v1.json');
  try {
    await fsp.writeFile(manifestPath, manifestJson, 'utf8');
  } catch (err: any) {
    log(`[warn] manifest write failed: ${err?.message || err}`);
  }
  try {
    await writeArtifact(buildId, 'build/manifest_v1.json', manifestJson);
  } catch (err: any) {
    log(`[warn] manifest artifact write failed: ${err?.message || err}`);
  }
}

function deriveTitles(appId: string, metadata: BundleMetadata) {
  const title =
    (typeof metadata.name === 'string' && metadata.name.trim()) || appId;
  const description =
    (typeof metadata.description === 'string' && metadata.description.trim()) || '';
  return { title, description };
}

function buildPreviewUrl(base: string | undefined, appId: string) {
  const normalizedBase = (base || '').replace(/\/+$/, '');
  const relative = `/preview/${appId}/`;
  const absolute = normalizedBase ? `${normalizedBase}${relative}` : relative;
  return { relative, absolute };
}

async function ensurePendingBuildRecord(buildId: string) {
  try {
    await initBuild(buildId);
  } catch {
    // ignore if already exists
  }
  await updateBuild(buildId, { state: 'pending_review', progress: 100, networkPolicy: 'NO_NET' });
}

async function upsertListing(
  appId: string,
  owner: LocalDevOwner | undefined,
  metadata: BundleMetadata,
  buildId: string,
  preview: { relative: string; absolute: string },
): Promise<{ listingId: string; slug: string }> {
  const apps = await readApps();
  const now = Date.now();
  const numericIds = apps
    .map((a) => Number(a.id))
    .filter((n) => Number.isFinite(n));
  const idx = apps.findIndex((a) => a.slug === appId || a.id === appId);
  const existing = idx >= 0 ? apps[idx] : undefined;
  const listingId = existing
    ? String(existing.id)
    : String((numericIds.length ? Math.max(...numericIds) : 0) + 1);

  const baseSlug =
    existing?.slug ||
    appId ||
    slugify(metadata.name || '') ||
    `app-${listingId}`;
  let slug = baseSlug;
  if (!existing) {
    let counter = 1;
    while (apps.some((a) => a.slug === slug)) {
      slug = `${baseSlug}-${counter++}`;
    }
  }

  const { title, description } = deriveTitles(slug, metadata);
  const tags =
    Array.isArray(metadata.tags) && metadata.tags.every((t) => typeof t === 'string')
      ? (metadata.tags as string[])
      : [];

  const { version, archivedVersions } = computeNextVersion(existing, now);
  const author =
    owner && owner.uid
      ? {
          uid: owner.uid,
          name: owner.name || existing?.author?.name,
          handle: owner.handle || existing?.author?.handle,
          photo: owner.photo || existing?.author?.photo,
        }
      : existing?.author;

  if (existing) {
    const mergedTags = tags.length ? tags : existing.tags ?? [];
    const defaultPlayUrl = `/play/${listingId}/`;
    const updated: AppRecord = {
      ...existing,
      slug,
      title,
      description,
      tags: mergedTags,
      updatedAt: now,
      status: 'pending-review',
      state: existing.state ?? 'draft',
      author,
      archivedVersions,
      pendingBuildId: buildId,
      pendingVersion: version,
      playUrl: existing.playUrl || defaultPlayUrl,
      previewUrl: preview.absolute,
    };
    const providedTranslations = sanitizeTranslations(metadata.translations);
    if (Object.keys(providedTranslations).length) {
      const currentTranslations = (existing as any).translations || {};
      (updated as any).translations = { ...currentTranslations };
      for (const [k, v] of Object.entries(providedTranslations)) {
        (updated as any).translations![k] = {
          ...(updated as any).translations?.[k],
          ...v,
        };
      }
    }
    apps[idx] = updated;
  } else {
    const record: AppRecord = {
      id: listingId,
      slug,
      buildId,
      title,
      description,
      tags,
      visibility: (metadata.visibility as any) === 'unlisted' ? 'unlisted' : 'public',
      accessMode: 'public',
      author,
      capabilities: {},
      createdAt: now,
      updatedAt: now,
      status: 'pending-review',
      state: 'draft',
      playUrl: `/play/${listingId}/`,
      previewUrl: preview.absolute,
      likesCount: 0,
      playsCount: 0,
      reports: [],
      domainsSeen: [],
      version,
      archivedVersions,
    };
    const providedTranslations = sanitizeTranslations(metadata.translations);
    if (Object.keys(providedTranslations).length) {
      (record as any).translations = providedTranslations as any;
    }
    apps.push(record);
  }

  await writeApps(apps);
  return { listingId, slug };
}

export function startLocalDevWorker() {
  const { DEV_QUEUE_CONCURRENCY } = getLocalDevConfig();
  const connection = getConnection();
  const worker = new Worker('thesara-builds', async (job: Job) => {
    const { appId, zipPath, allowScripts, owner } = job.data as JobData;
    const buildId = `local-${appId}-${job.id}`;
    const cfg = getLocalDevConfig();
    const tmpDir = path.join(cfg.buildTmpDir, `${appId}-${job.id}`);
    const appLogDir = path.join(cfg.logsDir, appId);
    await fsp.mkdir(tmpDir, { recursive: true });
    await fsp.mkdir(appLogDir, { recursive: true });
    const logFile = path.join(appLogDir, `${job.id}.log`);
    const logStream = createWriteStream(logFile, { flags: 'a' });
    const log = (s: string) => { logStream.write(typeof s === 'string' ? s : String(s)); if (!s.toString().endsWith('\n')) logStream.write('\n'); };
    try {
      log(`[worker] unzip -> ${tmpDir}`);
      await unzipTo(zipPath, tmpDir);

      const mode = cfg.DEV_BUILD_MODE;
      log(`[worker] build mode: ${mode}`);
      await runBuild(tmpDir, mode, !!allowScripts, (s) => log(s));

      const distPath = path.join(tmpDir, 'dist');
      await fsp.access(distPath).catch(() => { throw new Error('dist_missing'); });

      const deployed = await deployDist(appId, distPath);
      log(`[worker] deployed -> ${deployed}`);

      // Audit: zip hash and bundle artifacts
      const zipHash = await sha256File(zipPath);
      const bundleDir = await syncBundleDirectory(distPath, buildId, log);
      await rewriteIndexHtml(bundleDir, log);
      const cdnDomains = await detectExternalDomains(bundleDir, log);
      const outTar = path.join(appLogDir, `${job.id}.dist.tar.gz`);
      await tar.create({ gzip: true, file: outTar, cwd: bundleDir }, ['.']);
      const bundleHash = await sha256File(outTar);
      log(`[audit] zip.sha256=${zipHash}`);
      log(`[audit] bundle.sha256=${bundleHash}`);

      try {
        const bundleBuf = await fsp.readFile(outTar);
        await writeArtifact(buildId, 'bundle.tar.gz', bundleBuf);
      } catch (artifactErr: any) {
        log(`[warn] artifact bundle write failed: ${artifactErr?.message || artifactErr}`);
      }

      const metadata = await readBundleMetadata(tmpDir);
      try {
        await writeArtifact(buildId, 'metadata.json', JSON.stringify(metadata, null, 2));
      } catch (artifactErr: any) {
        log(`[warn] artifact metadata write failed: ${artifactErr?.message || artifactErr}`);
      }
      await ensureManifest(buildId, metadata, log, cdnDomains);

      await ensurePendingBuildRecord(buildId);
      if (cdnDomains && cdnDomains.length) { try { await updateBuild(buildId, { networkPolicy: 'OPEN_NET' as any }); } catch {} }
      const preview = buildPreviewUrl(cfg.THESARA_PUBLIC_BASE, appId);
      const { listingId, slug } = await upsertListing(
        appId,
        owner,
        metadata,
        buildId,
        preview,
      );

      return {
        status: 'completed',
        deployed,
        listingId,
        slug,
        previewUrl: preview.absolute,
        buildId,
      };
    } catch (err: any) {
      log(`[error] ${err?.stack || err?.message || String(err)}`);
      throw err;
    } finally {
      try { await rmrf(tmpDir); } catch {}
      logStream.end();
    }
  }, { concurrency: DEV_QUEUE_CONCURRENCY, ...connection });
  return worker;
}





