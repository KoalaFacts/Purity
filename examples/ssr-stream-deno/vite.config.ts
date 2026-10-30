// Vite config for the Deno example. Mirrors the cf-workers + Vercel
// edge configs: SSR build mode flips `@purityjs/vite-plugin` into the
// `generateSSR` codegen path so `html\`\`` calls AOT-compile to
// string-builder factories. The plugin's `buildStart` hook (ADR 0033)
// writes `src/.purity/routes.ts` as a side effect.

import { resolve } from 'node:path';
import { purity } from '@purityjs/vite-plugin';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  plugins: [
    purity({ hydratable: true, routes: { dir: 'src/pages', emitTo: 'src/.purity/routes.ts' } }),
  ],
  resolve: {
    alias: {
      '@purityjs/core/jit': resolve(import.meta.dirname, '../../packages/core/src/compiler/jit.ts'),
      '@purityjs/core/runtime': resolve(
        import.meta.dirname,
        '../../packages/core/src/compiler/runtime.ts',
      ),
      '@purityjs/compiler': resolve(import.meta.dirname, '../../packages/compiler/src/index.ts'),
      '@purityjs/core/hydration-bridge': resolve(
        import.meta.dirname,
        '../../packages/core/src/hydrate.ts',
      ),
      '@purityjs/core/ssr-bridge': resolve(
        import.meta.dirname,
        '../../packages/core/src/ssr-bridge.ts',
      ),
      '@purityjs/platform/signals': resolve(
        import.meta.dirname,
        '../../packages/platform/src/browser-signals/index.ts',
      ),
      '@purityjs/router': resolve(import.meta.dirname, '../../packages/router/src/index.ts'),
      '@purityjs/platform/actions': resolve(
        import.meta.dirname,
        '../../packages/platform/src/actions.ts',
      ),
      '@purityjs/platform/islands': resolve(
        import.meta.dirname,
        '../../packages/platform/src/islands.ts',
      ),
      '@purityjs/core/list-runtime': resolve(
        import.meta.dirname,
        '../../packages/core/src/control/list-runtime.ts',
      ),
      '@purityjs/platform/query': resolve(
        import.meta.dirname,
        '../../packages/platform/src/query-entry.ts',
      ),
      '@purityjs/core/csr-runtime': resolve(
        import.meta.dirname,
        '../../packages/core/src/runtime/csr-runtime.ts',
      ),
      '@purityjs/core': resolve(import.meta.dirname, '../../packages/core/src/index.ts'),
      '@purityjs/ssr/runtime': resolve(import.meta.dirname, '../../packages/ssr/src/runtime.ts'),
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
