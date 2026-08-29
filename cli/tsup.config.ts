import { defineConfig } from 'tsup'

export default defineConfig({
  banner: {
    js: '#!/usr/bin/env node',
  },
  clean: true,
  dts: false,
  entry: {
    'halo-cli': 'src/bin.ts',
  },
  format: ['cjs'],
  minify: false,
  noExternal: ['axios', 'cac', 'cli-table3', 'markdown-it'],
  outDir: 'dist',
  outExtension: () => ({ js: '.cjs' }),
  platform: 'node',
  shims: false,
  sourcemap: false,
  splitting: false,
  target: 'node20',
})
