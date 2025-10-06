import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { buildFromReact } from '../src/builder/build.ts';

// stub fetch to avoid network access
(globalThis as any).fetch = async (url: string) => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => new TextEncoder().encode('export default {}'),
  headers: new Map([[ 'content-type', 'application/javascript' ]]),
  url: String(url),
});

(async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'build-test-'));
  const code = "import x from 'some-unknown-package'; console.log(x); export default function App(){ return null }";
  const res = await buildFromReact(code, { cacheDir: tmp });
  assert.equal(res.ok, false);
  assert(res.error.includes('some-unknown-package'));
  console.log('unknown package build test passed');
})();
