import { resolve } from 'node:path';
import { purity } from '@purityjs/vite-plugin';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  base: '/Purity/docs/',
  plugins: [purity()],
  resolve: {
    alias: [
      {
        find: /^@purityjs\/core\/compiler$/,
        replacement: resolve(import.meta.dirname, '../../packages/core/src/compiler/index.ts'),
      },
      {
        find: /^@purityjs\/core$/,
        replacement: resolve(import.meta.dirname, '../../packages/core/src/index.ts'),
      },
    ],
  },
  build: { outDir: 'dist', target: 'es2022' },
});
