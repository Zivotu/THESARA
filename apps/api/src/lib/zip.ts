import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import { finished } from 'node:stream/promises';
import { PassThrough } from 'node:stream';
import { paths, updateArtifactIndex, ensureDir } from './artifacts.js';

export async function buildZip(id: string) {
  const { buildDir, zipPath } = paths(id);
  await ensureDir(buildDir);
  await fs.rm(zipPath, { force: true });
  const output = createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.directory(path.join(buildDir, 'build'), 'build');
  archive.file(path.join(buildDir, 'llm.json'), { name: 'llm.json' });
  archive.pipe(output);
  archive.finalize();
  await finished(output);
  const st = await fs.stat(zipPath);
  await updateArtifactIndex(id, [{ path: 'bundle.zip', size: st.size }]);
}

export async function zipDirectoryToBuffer(rootDir: string): Promise<Buffer> {
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.directory(rootDir, false);
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  archive.pipe(stream);
  archive.finalize();
  await finished(stream);
  return Buffer.concat(chunks);
}
