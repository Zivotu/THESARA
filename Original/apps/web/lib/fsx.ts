import fs from 'fs';
import path from 'path';

export async function ensureDir(p: string): Promise<void> {
  await fs.promises.mkdir(p, { recursive: true });
}

export function pathSafeJoin(root: string, ...parts: string[]): string {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, ...parts);
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path escapes root');
  }
  return resolvedPath;
}

export async function readJsonIfExists<T>(p: string): Promise<T | null> {
  try {
    const data = await fs.promises.readFile(p, 'utf8');
    return JSON.parse(data) as T;
  } catch (e: any) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return null;
    throw e;
  }
}
