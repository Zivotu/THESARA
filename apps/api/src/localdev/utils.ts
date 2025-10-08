import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

export function sanitizeAppId(raw: string): string {
  const v = (raw || '').toLowerCase().trim();
  if (!/^[a-z0-9-]{1,63}$/.test(v)) {
    throw new Error('invalid_app_id');
  }
  return v;
}

export async function ensureDir(p: string): Promise<void> {
  await fsp.mkdir(p, { recursive: true });
}

export async function tailFile(filePath: string, maxLines: number): Promise<string> {
  try {
    const data = await fsp.readFile(filePath, 'utf8');
    const lines = data.split(/\r?\n/);
    return lines.slice(-maxLines).join('\n');
  } catch {
    return '';
  }
}

export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const s = fs.createReadStream(filePath);
    s.on('error', reject);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
  });
}

export function assertInside(parent: string, p: string) {
  const rel = path.relative(parent, p);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('path_traversal');
  }
}

