import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { purity } from '@purityjs/vite-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

// Discover all .html files in each framework's app directory
const frameworks = ['purity', 'solid', 'svelte', 'vue'];
const inputs: Record<string, string> = {};
for (const fw of frameworks) {
  const dir = resolve(import.meta.dirname, `apps/${fw}`);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.html'))) {
    inputs[`${fw}-${f.replace('.html', '')}`] = resolve(dir, f);
  }
}

export default defineConfig({
  base: '/Purity/',
  plugins: [
    purity(),
    svelte({ compilerOptions: { runes: true } }),
    solid({ extensions: ['.tsx'] }),
    vue(),
  ],
  resolve: {
    // App-side imports of @purityjs/core go to source so we don't need to
    // rebuild packages/core between iterations. The compiler subpath is
    // handled by the package's "development" conditional export (see
    // packages/core/package.json) — both bench and the AOT plugin pick it
    // up because we run scripts with `node --conditions=development`.
    alias: {
      '@purityjs/core': resolve(import.meta.dirname, '../packages/core/src/index.ts'),
    },
  },
  build: {
    outDir: 'dist',
    rolldownOptions: { input: inputs },
  },
});
