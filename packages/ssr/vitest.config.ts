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
      '@purityjs/core/jit': resolve(import.meta.dirname, '../core/src/compiler/jit.ts'),
      '@purityjs/core/runtime': resolve(import.meta.dirname, '../core/src/compiler/runtime.ts'),
      '@purityjs/core/compiler': resolve(import.meta.dirname, '../core/src/compiler/index.ts'),
      '@purityjs/core/internal': resolve(import.meta.dirname, '../core/src/internal.ts'),
      '@purityjs/core/signals': resolve(
        import.meta.dirname,
        '../core/src/browser-signals/index.ts',
      ),
      '@purityjs/core/router': resolve(import.meta.dirname, '../core/src/router/index.ts'),
      '@purityjs/core/actions': resolve(import.meta.dirname, '../core/src/actions/index.ts'),
      '@purityjs/core/islands': resolve(import.meta.dirname, '../core/src/islands/index.ts'),
      '@purityjs/core/list-runtime': resolve(
        import.meta.dirname,
        '../core/src/control/list-runtime.ts',
      ),
      '@purityjs/core/query': resolve(import.meta.dirname, '../core/src/query/index.ts'),
      '@purityjs/core': resolve(import.meta.dirname, '../core/src/index.ts'),
    },
  },
});
