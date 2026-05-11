import { resolve } from 'node:path';
import { purity } from '@purityjs/vite-plugin';
import { defineConfig } from 'vite';

// Deployed at https://koalafacts.github.io/Purity/dashboard/
// In dev (DEMO_BASE=/) the base resets so vite preview works locally.
const base = process.env.DEMO_BASE ?? '/Purity/dashboard/';

export default defineConfig({
  base,
  plugins: [purity()],
  resolve: {
    alias: {
      '@purityjs/core': resolve(import.meta.dirname, '../../packages/core/src/index.ts'),
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
  },
});
