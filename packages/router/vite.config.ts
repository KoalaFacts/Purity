import { resolve } from 'node:path';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    clearMocks: false,
    environment: 'jsdom',
    maxWorkers: 4,
    alias: [
      {
        find: /^@purityjs\/core\/ssr-bridge$/,
        replacement: resolve(import.meta.dirname, '../core/src/ssr-bridge.ts'),
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
      entry: 'src/index.ts',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
    },
    rolldownOptions: { external: [/^@purityjs\//], output: { exports: 'named' } },
    sourcemap: true,
  },
});
