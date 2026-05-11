// Vite config for the Deno example. Mirrors the cf-workers + Vercel
// edge configs: SSR build mode flips `@purityjs/vite-plugin` into the
// `generateSSR` codegen path so `html\`\`` calls AOT-compile to
// string-builder factories. The plugin's `buildStart` hook (ADR 0033)
// writes `src/.purity/routes.ts` as a side effect.

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
    ssr: 'src/serve.ts',
    rollupOptions: {
      output: {
        entryFileNames: 'serve.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        format: 'es',
      },
    },
  },
  ssr: {
    // Deno is a server runtime — `node` is closer than `webworker` since
    // `Deno.serve` isn't a Worker-fetch shape. Either works for our
    // code (we only use Web Platform APIs); pick `node` for consistency
    // with what Vite's externalizer expects.
    target: 'node',
  },
});
