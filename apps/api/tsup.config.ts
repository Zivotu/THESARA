const path = require('node:path');
const { defineConfig } = require('tsup');

module.exports = defineConfig({
  entry: { server: 'src/index.ts' },
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  outDir: 'dist',
  outExtension() {
    return { js: '.cjs' };
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
      '@swc/helpers': path.join(__dirname, 'src/shims/swcHelpers.ts'),
    };
  },
});
