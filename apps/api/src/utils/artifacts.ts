import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { getConfig } from '../config.js';

export interface ArtifactMeta {
  path: string;
  size: number;
  sha256: string;
  createdAt: string;
}

export interface ArtifactIndex {
  artifacts: Record<string, ArtifactMeta>;
  createdAt: string;
}

const BASE_DIR = path.join(getConfig().BUNDLE_STORAGE_PATH, 'builds');

export function resolveBuildDir(buildId: string): string {
  return path.join(BASE_DIR, buildId);
}

export async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

export async function ensureBuildDirs(buildId: string): Promise<string> {
  const dir = resolveBuildDir(buildId);
  await ensureDir(dir);
  return dir;
}

export async function writeJson(p: string, data: any): Promise<void> {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify(data, null, 2));
}

export async function readJson<T>(p: string): Promise<T | null> {
  try {
    const txt = await fs.readFile(p, 'utf8');
    return JSON.parse(txt) as T;
  } catch {
    // Normalize to null so callers can use strict === null checks
    return null;
  }
}

export function indexPath(buildId: string): string {
  return path.join(resolveBuildDir(buildId), 'artifact_index.json');
}

export async function readIndex(buildId: string): Promise<ArtifactIndex> {
  try {
    const txt = await fs.readFile(indexPath(buildId), 'utf8');
    return JSON.parse(txt) as ArtifactIndex;
  } catch {
    return { artifacts: {}, createdAt: new Date().toISOString() };
  }
}

export async function writeIndex(buildId: string, index: ArtifactIndex): Promise<void> {
  await ensureBuildDirs(buildId);
  await writeJson(indexPath(buildId), index);
}

export async function writeArtifact(
  buildId: string,
  name: string,
  content: string | Buffer,
): Promise<ArtifactMeta> {
  const dir = await ensureBuildDirs(buildId);
  const p = path.join(dir, name);
  const buf = typeof content === 'string' ? Buffer.from(content) : content;
  await fs.writeFile(p, buf);
  const meta: ArtifactMeta = {
    path: p,
    size: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
    createdAt: new Date().toISOString(),
  };
  const idx = await readIndex(buildId);
  idx.artifacts[name] = meta;
  await writeIndex(buildId, idx);
  return meta;
}

export async function hasArtifact(buildId: string, name: string): Promise<boolean> {
  try {
    await fs.access(path.join(resolveBuildDir(buildId), name));
    return true;
  } catch {
    return false;
  }
}

export async function readArtifact(
  buildId: string,
  name: string,
  encoding: BufferEncoding = 'utf8',
): Promise<string> {
  const p = path.join(resolveBuildDir(buildId), name);
  return await fs.readFile(p, encoding);
}
