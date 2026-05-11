// Vite config for the cf-workers example. We use Vite both to emit the
// route manifest (via the plugin's `buildStart` hook — ADR 0033) AND to
// bundle the Worker itself in SSR mode (`vite build --ssr`). The SSR
// build pass is what AOT-compiles every `html\`\`` call in the page tree
// + worker entry into string-builder factories that can run on a
// Cloudflare Worker (no `document` required).
//
// Wrangler then deploys `dist/worker.js` — the Vite output. The worker
// source `src/worker.ts` lives in source control; the bundled artefact
// is gitignored.

import { resolve } from 'node:path';
import { purity } from '@purityjs/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    purity({
      routes: { dir: 'src/pages', emitTo: 'src/.purity/routes.ts' },
    }),
  ],
  resolve: {
    alias: {
      // Order matters: longer / more-specific subpath aliases must come
      // before their parent prefix. Mirrors the canonical SSR demo.
      '@purityjs/core/compiler': resolve(
        import.meta.dirname,
        '../../packages/core/src/compiler/index.ts',
      ),
      '@purityjs/core': resolve(import.meta.dirname, '../../packages/core/src/index.ts'),
      '@purityjs/ssr': resolve(import.meta.dirname, '../../packages/ssr/src/index.ts'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    minify: false,
    // `ssr: 'src/worker.ts'` turns on Vite's SSR codegen path — that's
    // what flips the plugin into `generateSSR` mode, so `html\`\`` calls
    // in the page tree compile into string-builder factories that run
    // on a Cloudflare Worker (no `document` required). Vite emits one
    // entry + per-route chunks; wrangler's ES-Modules Worker format
    // supports the multi-file shape natively.
    ssr: 'src/worker.ts',
    rollupOptions: {
      output: {
        entryFileNames: 'worker.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        format: 'es',
      },
    },
  },
  ssr: {
    target: 'webworker',
  },
});
