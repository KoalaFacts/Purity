import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { purity } from '../packages/vite-plugin/src/index.ts';

export default defineConfig({
  plugins: [
    purity(),
    svelte({ compilerOptions: { runes: true } }),
    solid({ extensions: ['.tsx'] }),
    vue(),
  ],
  resolve: {
    alias: {
      '@purity/core': resolve(import.meta.dirname, '../packages/core/src/index.ts'),
    },
  },
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
