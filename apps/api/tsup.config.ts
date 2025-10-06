import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: { server: 'src/index.ts' },
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  outDir: 'dist',
  outExtension() {
    return { js: '.js' };
  },
  noExternal: [
    /^(?:@loopyway\/entitlements)(?:$|\/)/,
  ],
  external: [
    'better-sqlite3',
    'puppeteer',
    '@google-cloud/storage',
    '@aws-sdk/client-s3',
    '@aws-sdk/lib-storage',
  ],
  esbuildOptions(options) {
    options.alias = {
      ...options.alias,
      '@swc/helpers': path.join(dirname, 'src/shims/swcHelpers.ts'),
    };
  },
});
