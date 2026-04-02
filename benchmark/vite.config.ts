import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { purity } from '../packages/vite-plugin/src/index.ts';

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
  plugins: [
    purity(),
    svelte({ compilerOptions: { runes: true } }),
    solid({ extensions: ['.tsx'] }),
    vue(),
  ],
  resolve: {
    alias: {
      '@purity/core': resolve(import.meta.dirname, '../packages/core/src/index.ts'),
      // signal-polyfill is a transitive dep of @purity/core; since we alias
      // core to source, the bundler needs to find signal-polyfill in the
      // benchmark node_modules (installed via benchmark/package.json).
      'signal-polyfill': resolve(import.meta.dirname, 'node_modules/signal-polyfill'),
    },
  },
  build: {
    outDir: 'dist',
    rolldownOptions: { input: inputs },
  },
});
