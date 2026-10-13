// Islands blog demo — ADR 0038. The shell renders entirely on the server;
// only the two islands ship client JS, and only when their trigger fires.
// `'load'` on the counter (hydrates immediately) and `'visible'` on the
// like button (hydrates when scrolled into view).
//
// The resolve aliases let the example consume the workspace packages
// from source so a single `npm install` at the repo root is enough.
import { resolve } from 'node:path';
import { purity } from '@purityjs/vite-plugin';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  plugins: [purity()],
  resolve: {
    alias: {
      '@purityjs/core/jit': resolve(import.meta.dirname, '../../packages/core/src/compiler/jit.ts'),
      '@purityjs/core/runtime': resolve(
        import.meta.dirname,
        '../../packages/core/src/compiler/runtime.ts',
      ),
      '@purityjs/core/compiler': resolve(
        import.meta.dirname,
        '../../packages/core/src/compiler/index.ts',
      ),
      '@purityjs/core/internal': resolve(
        import.meta.dirname,
        '../../packages/core/src/internal.ts',
      ),
      '@purityjs/core/signals': resolve(
        import.meta.dirname,
        '../../packages/core/src/browser-signals/index.ts',
      ),
      '@purityjs/core/router': resolve(
        import.meta.dirname,
        '../../packages/core/src/router/index.ts',
      ),
      '@purityjs/core/actions': resolve(
        import.meta.dirname,
        '../../packages/core/src/actions/index.ts',
      ),
      '@purityjs/core/islands': resolve(
        import.meta.dirname,
        '../../packages/core/src/islands/index.ts',
      ),
      '@purityjs/core/query': resolve(
        import.meta.dirname,
        '../../packages/core/src/query/index.ts',
      ),
      '@purityjs/core': resolve(import.meta.dirname, '../../packages/core/src/index.ts'),
      '@purityjs/ssr': resolve(import.meta.dirname, '../../packages/ssr/src/index.ts'),
    },
  },
  build: {
    minify: false,
  },
});
