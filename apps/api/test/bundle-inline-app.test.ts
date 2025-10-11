import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { bundleInlineApp } from '../src/lib/bundleInlineApp.ts';

const encoder = new TextEncoder();

(globalThis as any).fetch = async (url: string) => {
  const js = (() => {
    if (url.includes('jsx')) {
      return "export const jsx = () => null; export const jsxs = () => null; export const jsxDEV = () => null; export const Fragment = Symbol.for('react.fragment');";
    }
    if (url.includes('react-dom')) {
      return 'export const createRoot = () => ({ render(){}, unmount(){} });';
    }
    return 'export const createElement = () => null; export default { createElement };';
  })();

  return {
    ok: true,
    status: 200,
    url: String(url),
    headers: new Map([[ 'content-type', 'application/javascript' ]]),
    arrayBuffer: async () => encoder.encode(js).buffer,
  };
};

(async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'inline-bundle-'));
  const code = "export default function App(){ return <div>Hello</div>; }";
  const appJs = await bundleInlineApp(code, { cacheDir: tmp, allowAny: true, jsxDev: true });

  const bareImportRe = /from\s+['\"](?!\.{1,2}\/|\/|https?:\/\/)([^'\"]+)['\"]/;
  assert(!bareImportRe.test(appJs), `Expected no bare specifiers, got: ${appJs}`);
  assert(!appJs.includes('react/jsx-dev-runtime'));
  console.log('bundle inline app removes bare specifiers');
})();
