import extract from 'extract-zip';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { assertInside } from './utils.js';

export async function unzipTo(zipPath: string, destDir: string): Promise<void> {
  await fsp.mkdir(destDir, { recursive: true });
  await extract(zipPath, {
    dir: destDir,
    onEntry: (entry) => {
      const p = path.join(destDir, entry.fileName);
      assertInside(destDir, p);
    },
  });
}

