import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';

export async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}
export function existsSync(p: string) {
  try { fssync.accessSync(p); return true; } catch { return false; }
}
export async function readJson<T=any>(p: string, fallback: T | null = null): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(p, 'utf8')) as T; } catch { return fallback; }
}
export async function writeJson(p: string, data: any) {
  await ensureDir(path.dirname(p));
  const tmp = p + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, p);
}
