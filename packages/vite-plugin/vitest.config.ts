import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@purity/core/compiler': resolve(import.meta.dirname, '../core/src/compiler/index.ts'),
      '@purity/core': resolve(import.meta.dirname, '../core/src/index.ts'),
    },
  },
});
