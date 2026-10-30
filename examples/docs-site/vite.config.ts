import { resolve } from 'node:path';
import { purity } from '@purityjs/vite-plugin';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  base: '/Purity/docs/',
  plugins: [purity()],
  resolve: {
    alias: [
      {
        find: /^@purityjs\/compiler$/,
        replacement: resolve(import.meta.dirname, '../../packages/compiler/src/index.ts'),
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
        find: /^@purityjs\/compiler$/,
        replacement: resolve(import.meta.dirname, '../../packages/compiler/src/index.ts'),
      },
      {
        find: /^@purityjs\/core\/ssr-bridge$/,
        replacement: resolve(import.meta.dirname, '../../packages/core/src/ssr-bridge.ts'),
      },
      {
        find: /^@purityjs\/platform\/signals$/,
        replacement: resolve(
          import.meta.dirname,
          '../../packages/platform/src/browser-signals/index.ts',
        ),
      },
      {
        find: /^@purityjs\/router$/,
        replacement: resolve(import.meta.dirname, '../../packages/router/src/index.ts'),
      },
      {
        find: /^@purityjs\/platform\/actions$/,
        replacement: resolve(import.meta.dirname, '../../packages/platform/src/actions.ts'),
      },
      {
        find: /^@purityjs\/platform\/islands$/,
        replacement: resolve(import.meta.dirname, '../../packages/platform/src/islands.ts'),
      },
      {
        find: /^@purityjs\/core\/list-runtime$/,
        replacement: resolve(
          import.meta.dirname,
          '../../packages/core/src/control/list-runtime.ts',
        ),
      },
      {
        find: /^@purityjs\/platform\/query$/,
        replacement: resolve(import.meta.dirname, '../../packages/platform/src/query-entry.ts'),
      },
      {
        find: /^@purityjs\/core\/csr-runtime$/,
        replacement: resolve(import.meta.dirname, '../../packages/core/src/runtime/csr-runtime.ts'),
      },
      {
        find: /^@purityjs\/ssr\/runtime$/,
        replacement: resolve(import.meta.dirname, '../../packages/ssr/src/runtime.ts'),
      },
      {
        find: /^@purityjs\/ssr$/,
        replacement: resolve(import.meta.dirname, '../../packages/ssr/src/index.ts'),
      },
      {
        find: /^@purityjs\/core$/,
        replacement: resolve(import.meta.dirname, '../../packages/core/src/index.ts'),
      },
    ],
  },
  build: { outDir: 'dist', target: 'es2022' },
});
