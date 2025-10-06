import path from 'node:path';
import { promises as fs } from 'node:fs';
import { getBuildDir } from '../paths.js';

export { getBuildDir };

export function paths(id: string) {
  const buildDir = getBuildDir(id);
  return {
    buildDir,
    manifestPath: path.join(buildDir, 'build', 'manifest_v1.json'),
    planPath: path.join(buildDir, 'build', 'transform_plan_v1.json'),
    llmPath: path.join(buildDir, 'llm.json'),
    zipPath: path.join(buildDir, 'bundle.zip'),
    indexPath: path.join(buildDir, 'artifact_index.json'),
  } as const;
}

export async function readJson<T>(p: string): Promise<T | null> {
  try {
    const txt = await fs.readFile(p, 'utf8');
    return JSON.parse(txt) as T;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

export async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

export async function writeJson(p: string, data: any): Promise<void> {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify(data, null, 2));
}

export async function updateArtifactIndex(
  id: string,
  entries: Array<{ path: string; size?: number }>,
) {
  const { indexPath } = paths(id);
  await ensureDir(path.dirname(indexPath));
  let idx = await readJson<any>(indexPath);
  if (!idx) {
    idx = { id, createdAt: new Date().toISOString(), files: [] };
  }
  if (!Array.isArray(idx.files)) idx.files = [];
  const existing = new Map(idx.files.map((f: any) => [f.path, f]));
  for (const e of entries) existing.set(e.path, e);
  idx.files = Array.from(existing.values());
  await writeJson(indexPath, idx);
}
