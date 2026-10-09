import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { purity } from '@purityjs/vite-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite-plus';
import solid from '@solidjs/vite-plugin';

// Discover all .html files in each framework's app directory
const frameworks = ['purity', 'solid', 'svelte', 'vue', 'react'];
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
    // Solid and React both use .tsx. Each JSX plugin is scoped to its own app
    // directory so the two JSX transforms never see the same file.
    solid({ extensions: ['.tsx'], exclude: ['**/apps/react/**'] }),
    react({ include: /apps[\\/]react[\\/].*\.tsx$/ }),
    vue(),
  ],
  resolve: {
    // App-side imports of @purityjs/core go to source so we don't need to
    // rebuild packages/core between iterations. The compiler subpath is
    // handled by the package's "development" conditional export (see
    // packages/core/package.json) — both bench and the AOT plugin pick it
    // up because we run scripts with `node --conditions=development`.
    alias: [
      {
        find: /^@purityjs\/core$/,
        replacement: resolve(import.meta.dirname, '../packages/core/src/index.ts'),
      },
    ],
  },
  build: {
    outDir: 'dist',
    // Sourcemaps so tools/analyze.ts can map minified frames in the
    // .cpuprofile back to source files. Set PROFILE_MINIFY=0 to also
    // disable minification when you need to read raw identifier names.
    sourcemap: true,
    minify: process.env.PROFILE_MINIFY === '0' ? false : 'esbuild',
    rolldownOptions: { input: inputs },
  },
});
