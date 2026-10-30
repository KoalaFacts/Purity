import { resolve } from 'node:path';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@purityjs/ssr/runtime': resolve(import.meta.dirname, 'src/runtime.ts'),
      '@purityjs/compiler': resolve(import.meta.dirname, '../compiler/src/index.ts'),
      '@purityjs/core/hydration-bridge': resolve(import.meta.dirname, '../core/src/hydrate.ts'),
      '@purityjs/core/ssr-bridge': resolve(import.meta.dirname, '../core/src/ssr-bridge.ts'),
      '@purityjs/core/jit': resolve(import.meta.dirname, '../core/src/compiler/jit.ts'),
      '@purityjs/core/runtime': resolve(import.meta.dirname, '../core/src/compiler/runtime.ts'),
      '@purityjs/platform/signals': resolve(
        import.meta.dirname,
        '../platform/src/browser-signals/index.ts',
      ),
      '@purityjs/router': resolve(import.meta.dirname, '../router/src/index.ts'),
      '@purityjs/platform/actions': resolve(import.meta.dirname, '../platform/src/actions.ts'),
      '@purityjs/platform/islands': resolve(import.meta.dirname, '../platform/src/islands.ts'),
      '@purityjs/core/list-runtime': resolve(
        import.meta.dirname,
        '../core/src/control/list-runtime.ts',
      ),
      '@purityjs/platform/query': resolve(import.meta.dirname, '../platform/src/query-entry.ts'),
      '@purityjs/core': resolve(import.meta.dirname, '../core/src/index.ts'),
    },
  },
});
