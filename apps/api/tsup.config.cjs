// apps/api/tsup.config.cjs
const { defineConfig } = require('tsup');
module.exports = defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  splitting: false,
  sourcemap: false,
  clean: true,
  dts: false,
  minify: false,
  shims: false,
});
