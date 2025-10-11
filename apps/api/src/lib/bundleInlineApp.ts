import path from 'node:path';
import fs from 'node:fs';
import * as esbuild from 'esbuild';
import { cdnImportPlugin, type Opts as CdnOpts } from '../builder/cdnPlugin.js';

const DIRNAME =
  typeof __dirname === 'undefined'
    ? path.dirname(new URL('.', import.meta.url).pathname)
    : __dirname;

function resolvePluginRoot(): string {
  const routeRoot = path.resolve(DIRNAME, '..');
  const distCandidate = path.join(routeRoot, 'builder', 'virtual-ui.tsx');
  if (fs.existsSync(distCandidate)) {
    return routeRoot;
  }
  const srcCandidate = path.join(routeRoot, '..', 'src', 'builder', 'virtual-ui.tsx');
  if (fs.existsSync(srcCandidate)) {
    return path.join(routeRoot, '..', 'src');
  }
  return routeRoot;
}

export type BundleInlineAppOptions = Pick<CdnOpts, 'cacheDir' | 'allow' | 'pin' | 'allowAny' | 'cdnBase'> & {
  jsxDev?: boolean;
  rootDir?: string;
};

export async function bundleInlineApp(
  code: string,
  options: BundleInlineAppOptions,
): Promise<string> {
  const pluginRoot = options.rootDir ?? resolvePluginRoot();
  const buildResult = await esbuild.build({
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: ['es2018'],
    jsx: 'automatic',
    jsxDev: options.jsxDev ?? process.env.NODE_ENV !== 'production',
    loader: {
      '.ts': 'ts',
      '.tsx': 'tsx',
      '.js': 'js',
      '.jsx': 'jsx',
    },
    stdin: {
      contents: code,
      loader: 'tsx',
      resolveDir: pluginRoot,
      sourcefile: 'inline-app.tsx',
    },
    plugins: [
      cdnImportPlugin({
        ...options,
        cacheDir: options.cacheDir,
        rootDir: pluginRoot,
      }),
    ],
  });

  const outJs = buildResult.outputFiles?.[0]?.text ?? '';
  const unresolved: string[] = [];
  const importStmtRe = /(?:^|\n)\s*import(?:[^'"`]*?from\s*)?["'`](.*?)["'`]/g;
  const importCallRe = /import\((?:'|")(.*?)(?:'|")\)/g;

  for (const match of outJs.matchAll(importStmtRe)) {
    const spec = match[1];
    if (!spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('http://') && !spec.startsWith('https://')) {
      unresolved.push(spec);
    }
  }
  for (const match of outJs.matchAll(importCallRe)) {
    const spec = match[1];
    if (!spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('http://') && !spec.startsWith('https://')) {
      unresolved.push(spec);
    }
  }

  if (unresolved.length) {
    throw new Error(`Unresolved imports: ${unresolved.join(', ')}`);
  }

  return outJs;
}
