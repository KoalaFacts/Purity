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
        find: /^@purityjs\/core\/jit$/,
        replacement: resolve(import.meta.dirname, '../../packages/core/src/compiler/jit.ts'),
      },
      {
        find: /^@purityjs\/core\/runtime$/,
        replacement: resolve(import.meta.dirname, '../../packages/core/src/compiler/runtime.ts'),
      },
      {
        find: /^@purityjs\/core\/compiler$/,
        replacement: resolve(import.meta.dirname, '../../packages/core/src/compiler/index.ts'),
      },
      {
        find: /^@purityjs\/core\/internal$/,
        replacement: resolve(import.meta.dirname, '../../packages/core/src/internal.ts'),
      },
      {
        find: /^@purityjs\/core\/signals$/,
        replacement: resolve(
          import.meta.dirname,
          '../../packages/core/src/browser-signals/index.ts',
        ),
      },
      {
        find: /^@purityjs\/core\/router$/,
        replacement: resolve(import.meta.dirname, '../../packages/core/src/router/index.ts'),
      },
      {
        find: /^@purityjs\/core\/actions$/,
        replacement: resolve(import.meta.dirname, '../../packages/core/src/actions/index.ts'),
      },
      {
        find: /^@purityjs\/core\/islands$/,
        replacement: resolve(import.meta.dirname, '../../packages/core/src/islands/index.ts'),
      },
      {
        find: /^@purityjs\/core\/list-runtime$/,
        replacement: resolve(
          import.meta.dirname,
          '../../packages/core/src/control/list-runtime.ts',
        ),
      },
      {
        find: /^@purityjs\/core\/query$/,
        replacement: resolve(import.meta.dirname, '../../packages/core/src/query/index.ts'),
      },
      {
        find: /^@purityjs\/core$/,
        replacement: resolve(import.meta.dirname, '../../packages/core/src/index.ts'),
      },
    ],
  },
  build: { outDir: 'dist', target: 'es2022' },
});
