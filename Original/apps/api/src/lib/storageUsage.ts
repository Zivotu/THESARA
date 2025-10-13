import path from 'node:path';
import { promises as fs } from 'node:fs';
import { getConfig } from '../config.js';
import { getBucket } from '../storage.js';

async function dirSize(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += await dirSize(full);
      } else {
        const stat = await fs.stat(full);
        total += stat.size;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

export async function getUserStorageBytes(buildIds: string[]): Promise<number> {
  const { STORAGE_DRIVER, BUNDLE_STORAGE_PATH } = getConfig();
  if (STORAGE_DRIVER === 'local') {
    let total = 0;
    for (const id of buildIds) {
      const dir = path.join(BUNDLE_STORAGE_PATH, 'builds', id);
      total += await dirSize(dir);
    }
    return total;
  }
  const bucket = getBucket();
  let total = 0;
  for (const id of buildIds) {
    const [files] = await bucket.getFiles({ prefix: `builds/${id}/` });
    for (const file of files) {
      const size = Number(file.metadata?.size || 0);
      total += size;
    }
  }
  return total;
}
