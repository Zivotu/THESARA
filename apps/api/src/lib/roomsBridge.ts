import fs from 'node:fs';
import path from 'node:path';

const TEXT_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.json',
  '.html',
  '.htm',
  '.css',
  '.txt',
  '.map',
  '.vue',
  '.svelte',
]);

const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '__MACOSX']);
const MAX_SCAN_BYTES = 1_000_000; // 1 MB per file

function shouldScanFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  const ext = path.extname(lower);
  if (!ext) return false;
  return TEXT_EXTENSIONS.has(ext);
}

export async function detectRoomsStorageKeys(
  rootDir: string,
  keys: string[],
  log?: (message: string) => void,
): Promise<string[]> {
  const uniqueKeys = Array.from(new Set(keys.filter((key) => typeof key === 'string' && key.trim().length > 0)));
  if (uniqueKeys.length === 0) return [];

  const matches = new Set<string>();
  const stack: string[] = [rootDir];

  while (stack.length && matches.size < uniqueKeys.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch (err) {
      log?.(`[rooms-bridge] scan_skip_dir:${current}:${(err as any)?.message || err}`);
      continue;
    }

    for (const entry of entries) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      try {
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        if (!shouldScanFile(entry.name)) continue;
        const stat = await fs.promises.stat(fullPath);
        if (stat.size > MAX_SCAN_BYTES) continue;
        const content = await fs.promises.readFile(fullPath, 'utf8');
        for (const key of uniqueKeys) {
          if (matches.has(key)) continue;
          if (content.includes(key)) {
            matches.add(key);
          }
        }
      } catch (err) {
        log?.(`[rooms-bridge] scan_skip_file:${fullPath}:${(err as any)?.message || err}`);
      }
      if (matches.size >= uniqueKeys.length) break;
    }
  }

  return uniqueKeys.filter((key) => matches.has(key));
}
