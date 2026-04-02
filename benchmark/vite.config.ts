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
        purity: resolve(import.meta.dirname, 'apps/purity/index.html'),
        solid: resolve(import.meta.dirname, 'apps/solid/index.html'),
        svelte: resolve(import.meta.dirname, 'apps/svelte/index.html'),
        vue: resolve(import.meta.dirname, 'apps/vue/index.html'),
      },
    },
  },
});
