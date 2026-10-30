import { resolve } from 'node:path';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
    alias: [
      {
        find: /^@purityjs\/core\/ssr-bridge$/,
        replacement: resolve(import.meta.dirname, 'src/ssr-bridge.ts'),
      },
      { find: /^@purityjs\/core$/, replacement: resolve(import.meta.dirname, 'src/index.ts') },
      {
        find: /^@purityjs\/ssr\/runtime$/,
        replacement: resolve(import.meta.dirname, '../ssr/src/runtime.ts'),
      },
      {
        find: /^@purityjs\/signals$/,
        replacement: resolve(import.meta.dirname, '../signals/src/index.ts'),
      },
    ],
    environment: 'jsdom',
    maxWorkers: 4,
  },
});
