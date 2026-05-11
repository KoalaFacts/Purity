// Vite config for the Vercel Edge example. Vite SSR-builds
// `src/edge.ts` to `api/stream.js` so Vercel's Edge runtime picks it
// up directly. The plugin's `buildStart` hook (ADR 0033) emits
// `src/.purity/routes.ts` as a side effect of the build.

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
    // Vercel scans `api/` for handler files; the built bundle lives
    // there alongside any other hand-written API routes.
    outDir: 'api',
    emptyOutDir: false,
    target: 'esnext',
    minify: false,
    ssr: 'src/edge.ts',
    rollupOptions: {
      output: {
        entryFileNames: 'stream.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        format: 'es',
      },
    },
  },
  ssr: {
    target: 'webworker',
  },
});
