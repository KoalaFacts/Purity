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
  plugins: [purity({ hydratable: true })],
  resolve: {
    alias: {
      '@purityjs/core/jit': resolve(import.meta.dirname, '../../packages/core/src/compiler/jit.ts'),
      '@purityjs/core/runtime': resolve(
        import.meta.dirname,
        '../../packages/core/src/compiler/runtime.ts',
      ),
      '@purityjs/compiler': resolve(import.meta.dirname, '../../packages/compiler/src/index.ts'),
      '@purityjs/core/hydration-bridge': resolve(
        import.meta.dirname,
        '../../packages/core/src/hydrate.ts',
      ),
      '@purityjs/core/ssr-bridge': resolve(
        import.meta.dirname,
        '../../packages/core/src/ssr-bridge.ts',
      ),
      '@purityjs/platform/signals': resolve(
        import.meta.dirname,
        '../../packages/platform/src/browser-signals/index.ts',
      ),
      '@purityjs/router': resolve(import.meta.dirname, '../../packages/router/src/index.ts'),
      '@purityjs/platform/actions': resolve(
        import.meta.dirname,
        '../../packages/platform/src/actions.ts',
      ),
      '@purityjs/platform/islands': resolve(
        import.meta.dirname,
        '../../packages/platform/src/islands.ts',
      ),
      '@purityjs/core/list-runtime': resolve(
        import.meta.dirname,
        '../../packages/core/src/control/list-runtime.ts',
      ),
      '@purityjs/platform/query': resolve(
        import.meta.dirname,
        '../../packages/platform/src/query-entry.ts',
      ),
      '@purityjs/core/csr-runtime': resolve(
        import.meta.dirname,
        '../../packages/core/src/runtime/csr-runtime.ts',
      ),
      '@purityjs/core': resolve(import.meta.dirname, '../../packages/core/src/index.ts'),
      '@purityjs/ssr/runtime': resolve(import.meta.dirname, '../../packages/ssr/src/runtime.ts'),
      '@purityjs/ssr': resolve(import.meta.dirname, '../../packages/ssr/src/index.ts'),
    },
  },
  build: {
    minify: false,
  },
});
