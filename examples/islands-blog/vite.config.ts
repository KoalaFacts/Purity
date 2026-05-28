// Islands blog demo — ADR 0038. The shell renders entirely on the server;
// only the two islands ship client JS, and only when their trigger fires.
// `'load'` on the counter (hydrates immediately) and `'visible'` on the
// like button (hydrates when scrolled into view).
//
// The resolve aliases let the example consume the workspace packages
// from source so a single `npm install` at the repo root is enough.
import { resolve } from 'node:path';
import { purity } from '@purityjs/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [purity()],
  resolve: {
    alias: {
      '@purityjs/core/compiler': resolve(
        import.meta.dirname,
        '../../packages/core/src/compiler/index.ts',
      ),
      '@purityjs/core': resolve(import.meta.dirname, '../../packages/core/src/index.ts'),
      '@purityjs/ssr': resolve(import.meta.dirname, '../../packages/ssr/src/index.ts'),
    },
  },
  build: {
    minify: false,
  },
});
