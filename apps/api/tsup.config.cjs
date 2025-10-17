const { defineConfig } = require('tsup');
  module.exports = defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs'],
    target: 'node20',
    outDir: 'dist',
    platform: 'node',
    splitting: false,
    sourcemap: false,
    clean: true,
    dts: false,
    minify: false,
    shims: false,
  });