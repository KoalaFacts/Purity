import { resolve } from 'node:path';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    clearMocks: false,
    alias: [
      {
        find: /^@purityjs\/core\/ssr-bridge$/,
        replacement: resolve(import.meta.dirname, '../core/src/ssr-bridge.ts'),
      },
      {
        find: /^@purityjs\/core\/hydration-bridge$/,
        replacement: resolve(import.meta.dirname, '../core/src/hydrate.ts'),
      },
      {
        find: /^@purityjs\/core$/,
        replacement: resolve(import.meta.dirname, '../core/src/index.ts'),
      },
      {
        find: /^@purityjs\/ssr\/runtime$/,
        replacement: resolve(import.meta.dirname, '../ssr/src/runtime.ts'),
      },
      {
        find: /^@purityjs\/signals$/,
        replacement: resolve(import.meta.dirname, '../signals/src/index.ts'),
      },
    ],
  },
  build: {
    lib: {
      entry: {
        actions: 'src/actions.ts',
        signals: 'src/browser-signals/index.ts',
        query: 'src/query-entry.ts',
        islands: 'src/islands.ts',
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
    },
    rolldownOptions: { external: [/^@purityjs\//], output: { exports: 'named' } },
    sourcemap: true,
  },
});
