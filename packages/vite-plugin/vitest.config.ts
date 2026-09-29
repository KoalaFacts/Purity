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
      '@purityjs/core/compiler': resolve(import.meta.dirname, '../core/src/compiler/index.ts'),
      '@purityjs/core': resolve(import.meta.dirname, '../core/src/index.ts'),
    },
  },
});
