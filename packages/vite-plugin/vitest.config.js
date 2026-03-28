import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@purity/core/compiler': resolve(__dirname, '../core/src/compiler/index.ts'),
      '@purity/core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
});
