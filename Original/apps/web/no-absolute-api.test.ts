import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { expect, test } from 'vitest';

function collect(dir: string, out: string[] = []) {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.next', 'build', 'out'].includes(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) collect(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !full.endsWith(path.join('lib', 'api.ts'))) out.push(full);
  }
  return out;
}

test('no hardcoded local API hosts in source', () => {
  const root = path.resolve(__dirname);
  const files = collect(root);
  const pattern = /http:\/\/(?:127\.0\.0\.1|localhost):8788/i;
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (!content.includes('use client')) continue;
    expect(content).not.toMatch(pattern);
  }
});
