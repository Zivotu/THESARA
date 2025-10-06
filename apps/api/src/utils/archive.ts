import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

export async function createZipFromDir(inputDir: string, outZip: string) {
  await fs.promises.mkdir(path.dirname(outZip), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(outZip);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(inputDir, false);
    archive.finalize();
  });
}
