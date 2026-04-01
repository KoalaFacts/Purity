import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { purity } from '../packages/vite-plugin/src/index.ts';

export default defineConfig({
  plugins: [purity()],
  build: {
    outDir: 'dist',
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        bench: resolve(import.meta.dirname, 'bench.html'),
      },
    },
  },
});
