import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getConfig } from '../config.js';
import { getBucket } from '../storage.js';
import { getBuildDir } from '../paths.js';
import { AppError } from '../lib/errors.js';
import { fileExists, dirExists } from '../lib/fs.js';
import * as tar from 'tar';
import { getBucket } from '../storage.js';
import type { SafePublishResult } from '../safePublish.js';

export type BuildState =
  | 'queued'
  | 'init'
  | 'analyze'
  | 'build'
  | 'bundle'
  | 'verify'
  | 'ai_scan'
  | 'llm_waiting'
  | 'llm_generating'
  | 'pending_review'
  | 'pending_review_llm'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'failed';

export interface BuildRecord {
  id: string;
  state: BuildState;
  progress: number;
  timeline: Array<{ state: BuildState; at: number }>;
  createdAt: number;
  error?: string;
  reasons?: string[];
  llmAttempts?: number;
  llmAttemptWindowStart?: number;
  // relative path to stored LLM review report (llm.json)
  llmReportPath?: string;
  networkPolicy?: 'NO_NET' | 'MEDIA_ONLY' | 'OPEN_NET';
  networkPolicyReason?: string;
}

const { BUNDLE_STORAGE_PATH } = getConfig();
const BUILDS_ROOT = path.join(BUNDLE_STORAGE_PATH, 'builds');
const INDEX_PATH = path.join(BUILDS_ROOT, 'index.json');

interface BuildIndexEntry {
  id: string;
  createdAt: number;
}

async function readIndex(): Promise<BuildIndexEntry[]> {
  try {
    const txt = await fs.readFile(INDEX_PATH, 'utf8');
    return JSON.parse(txt) as BuildIndexEntry[];
  } catch {
    return [];
  }
}

async function writeIndex(items: BuildIndexEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(INDEX_PATH), { recursive: true });
  await fs.writeFile(INDEX_PATH, JSON.stringify(items, null, 2));
}

async function ensureIndexEntry(id: string, createdAt: number): Promise<void> {
  const idx = await readIndex();
  if (!idx.find((e) => e.id === id)) {
    idx.push({ id, createdAt });
    idx.sort((a, b) => b.createdAt - a.createdAt);
    await writeIndex(idx);
  }
}

function recordPath(id: string): string {
  return path.join(BUILDS_ROOT, id, 'build.json');
}

export async function readBuild(id: string): Promise<BuildRecord | undefined> {
  try {
    const txt = await fs.readFile(recordPath(id), 'utf8');
    return JSON.parse(txt) as BuildRecord;
  } catch {
    return undefined;
  }
}

export async function writeBuild(rec: BuildRecord): Promise<void> {
  const p = recordPath(rec.id);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(rec, null, 2));
  await ensureIndexEntry(rec.id, rec.createdAt);
}

export async function initBuild(id: string): Promise<BuildRecord> {
  const rec: BuildRecord = {
    id,
    state: 'queued',
    progress: 0,
    timeline: [{ state: 'queued', at: Date.now() }],
    createdAt: Date.now(),
  };
  await writeBuild(rec);
  return rec;
}

export async function updateBuild(
  id: string,
  patch: Partial<
    Pick<
      BuildRecord,
      |
        'state'
      | 'progress'
      | 'error'
      | 'reasons'
      | 'llmReportPath'
      | 'networkPolicy'
      | 'networkPolicyReason'
      | 'llmAttempts'
      | 'llmAttemptWindowStart'
    >
  >,
): Promise<BuildRecord> {
  const current = (await readBuild(id)) || (await initBuild(id));
  const next: BuildRecord = { ...current, ...patch };
  if (patch.state && patch.state !== current.state) {
    next.timeline = [...current.timeline, { state: patch.state, at: Date.now() }];
  } else {
    next.timeline = current.timeline;
  }
  await writeBuild(next);
  return next;
}

export async function applyPipelineResult(
  id: string,
  result: SafePublishResult,
): Promise<BuildRecord> {
  const stateMap: Record<SafePublishResult['status'], BuildState> = {
    approved: 'approved',
    'pending-review': 'pending_review',
    'pending-review-llm': 'pending_review_llm',
    rejected: 'rejected',
  };
  const patch: Partial<BuildRecord> = { state: stateMap[result.status] };
  if (result.status === 'pending-review' || result.status === 'rejected') {
    patch.reasons = result.reasons;
    patch.error = result.reasons?.[0];
  }
  return updateBuild(id, patch);
}

export async function listBuilds(
  cursor?: number,
  limit = 20,
): Promise<{ items: BuildRecord[]; nextCursor?: number }> {
  const index = await readIndex();
  const sorted = index.sort((a, b) => b.createdAt - a.createdAt);
  const filtered = cursor ? sorted.filter((e) => e.createdAt < cursor) : sorted;
  const slice = filtered.slice(0, limit);
  const items: BuildRecord[] = [];
  for (const entry of slice) {
    const rec = await readBuild(entry.id);
    if (rec) items.push(rec);
  }
  const nextCursor = filtered.length > limit ? slice[slice.length - 1]?.createdAt : undefined;
  return { items, nextCursor };
}

export interface ArtifactInfo {
  exists: boolean;
  url?: string;
}

export interface BuildArtifacts {
  preview: ArtifactInfo;
  ast: ArtifactInfo;
  manifest: ArtifactInfo;
  llm: ArtifactInfo;
  bundle: ArtifactInfo;
  networkPolicy?: string;
  networkPolicyReason?: string;
}

export async function getBuildArtifacts(id: string): Promise<BuildArtifacts> {
  const dir = getBuildDir(id);
  const buildDir = path.join(dir, 'build');
  const astPath = path.join(buildDir, 'AST_SUMMARY.json');
  const manifestPath = path.join(buildDir, 'manifest_v1.json');
  const llmPath = path.join(dir, 'llm.json');
  const rec = await readBuild(id);
  const bucket = getBucket();
  const bundleFile = bucket.file(`builds/${id}/bundle.tar.gz`);
  const [bundleExists] = await bundleFile.exists();
  // Also expose bundle if local build directory exists (pre-publish fallback)
  const localBundleDir = path.join(getBuildDir(id), 'bundle');
  const localBundleExists = await dirExists(localBundleDir);

  return {
    preview: { exists: false },
    ast: (await fileExists(astPath))
      ? { exists: true, url: `/builds/${id}/build/AST_SUMMARY.json` }
      : { exists: false },
    manifest: (await fileExists(manifestPath))
      ? { exists: true, url: `/builds/${id}/build/manifest_v1.json` }
      : { exists: false },
    llm: (await fileExists(llmPath))
      ? { exists: true, url: `/review/builds/${id}/llm` }
      : { exists: false },
    bundle: bundleExists || localBundleExists
      ? { exists: true, url: `/review/code/${id}` }
      : { exists: false },
    networkPolicy: rec?.networkPolicy,
    networkPolicyReason: rec?.networkPolicyReason,
  };
}

export async function publishBundle(id: string): Promise<void> {
  // Prefer 'bundle/' but fall back to 'build/' in local/dev pipeline
  const baseDir = path.join(BUILDS_ROOT, id);
  let src = path.join(baseDir, 'bundle');
  if (!(await dirExists(src))) {
    const alt = path.join(baseDir, 'build');
    if (await dirExists(alt)) {
      src = alt;
    } else {
      throw new AppError('BUNDLE_SRC_NOT_FOUND');
    }
  }

  // verify essential files exist before publishing; if missing try to hydrate from root copies
  const required = ['index.html', 'app.js'];
  for (const file of required) {
    const target = path.join(src, file);
    const rootCopy = path.join(baseDir, file);
    if (!(await fileExists(target))) {
      if (await fileExists(rootCopy)) {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(rootCopy, target);
      }
    }
    if (!(await fileExists(target))) {
      throw new AppError(
        'BUILD_REQUIRED_FILE_MISSING',
        `Missing required file(s): ${file}`,
      );
    }
  }

  // In local dev mode or non-firebase storage, skip cloud upload and keep local directory.
  // Review download endpoint can stream a tar.gz from this local folder.
  const cfg0 = getConfig();
  const KEEP_LOCAL_BUNDLE = process.env.KEEP_LOCAL_BUNDLE === 'true';
  if (cfg0.STORAGE_DRIVER !== 'firebase') {
    console.log(`publishBundle: skip cloud upload (STORAGE_DRIVER=${cfg0.STORAGE_DRIVER})`);
    // Keep local bundle for direct serving under /builds/:id/bundle/
    return;
  }

  const cfg = getConfig();
  const tmpTar = path.join(cfg.TMP_PATH, `${id}-bundle.tar.gz`);
  await fs.mkdir(path.dirname(tmpTar), { recursive: true });
  await tar.c({ gzip: true, cwd: src, file: tmpTar }, ['.']);

  const bucket = getBucket();
  console.log('publishBundle: uploading to bucket', bucket.name, `builds/${id}/bundle.tar.gz`);
  await bucket.upload(tmpTar, {
    destination: `builds/${id}/bundle.tar.gz`,
    contentType: 'application/gzip',
  });
  console.log('publishBundle: upload complete');

  // Also upload exploded bundle directory so /public/builds/:id/index.html works
  const uploadDirRecursive = async (dir: string, base: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(base, abs).replace(/\\/g, '/');
      const dest = `builds/${id}/${rel}`;
      if (e.isDirectory()) {
        await uploadDirRecursive(abs, base);
      } else {
        // Set a reasonable content-type for common assets to avoid ORB/CORB issues
        const ext = path.extname(abs).toLowerCase();
        const contentType =
          ext === '.html' ? 'text/html; charset=utf-8'
          : ext === '.js' ? 'application/javascript; charset=utf-8'
          : ext === '.css' ? 'text/css; charset=utf-8'
          : ext === '.json' ? 'application/json; charset=utf-8'
          : ext === '.png' ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
          : ext === '.svg' ? 'image/svg+xml'
          : undefined;
        const metadata: any = {};
        if (contentType) metadata.contentType = contentType;
        metadata.cacheControl = 'public, max-age=600';
        await bucket.upload(abs, { destination: dest, metadata });
      }
    }
  };
  try {
    await uploadDirRecursive(src, src);
    console.log('publishBundle: uploaded exploded bundle directory to bucket');
  } catch (err) {
    console.warn('publishBundle: failed to upload exploded bundle directory', err);
  }

  await fs.rm(tmpTar, { force: true });
  if (!KEEP_LOCAL_BUNDLE) {
    await fs.rm(src, { recursive: true, force: true });
  }
}

