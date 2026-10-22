import { resolve } from 'node:path';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@purityjs\/core\/jit$/,
        replacement: resolve(import.meta.dirname, '../packages/core/src/compiler/jit.ts'),
      },
      {
        find: /^@purityjs\/core$/,
        replacement: resolve(import.meta.dirname, '../packages/core/src/index.ts'),
      },
    ],
  },
  test: { environment: 'jsdom', include: ['tools/*.test.ts'] },
});
