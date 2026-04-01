import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { purity } from '../packages/vite-plugin/src/index.ts';

export default defineConfig({
  plugins: [
    purity(),
    svelte({ compilerOptions: { runes: true } }),
  ],
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
