import { promises as fsp } from 'node:fs';
import path from 'node:path';

export async function rmrf(p: string): Promise<void> {
  await fsp.rm(p, { recursive: true, force: true });
}

export async function copyDir(src: string, dest: string): Promise<void> {
  await fsp.mkdir(dest, { recursive: true });
  await fsp.cp(src, dest, { recursive: true });
}

export async function copyDirAtomic(src: string, dest: string): Promise<void> {
  const parent = path.dirname(dest);
  const tmp = path.join(parent, path.basename(dest) + '.__new');
  const bak = path.join(parent, path.basename(dest) + '.__old');
  await rmrf(tmp);
  await copyDir(src, tmp);
  await fsp.mkdir(parent, { recursive: true });
  // Swap
  const hasDest = await exists(dest);
  if (hasDest) {
    await rmrf(bak);
    try { await fsp.rename(dest, bak); } catch {}
  }
  await fsp.rename(tmp, dest);
  // Cleanup old if present (best-effort)
  try { await rmrf(bak); } catch {}
}

export async function exists(p: string): Promise<boolean> {
  try { await fsp.access(p); return true; } catch { return false; }
}

