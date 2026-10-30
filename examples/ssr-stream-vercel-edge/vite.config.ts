// Vite config for the Vercel Edge example. Vite SSR-builds
// `src/edge.ts` to `dist/edge.js`. The tracked API wrapper preserves the
// static Edge runtime declaration. The plugin's `buildStart` hook (ADR 0033) emits
// `src/.purity/routes.ts` as a side effect of the build.

import { resolve } from 'node:path';
import { purity } from '@purityjs/vite-plugin';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  plugins: [
    purity({ hydratable: true, routes: { dir: 'src/pages', emitTo: 'src/.purity/routes.ts' } }),
  ],
  resolve: {
    alias: {
      // Order matters: longer / more-specific subpath aliases must come
      // before their parent prefix. Mirrors the canonical SSR demo.
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
    // Keep generated chunks outside Vercel's scanned API route directory.
    outDir: 'dist',
    target: 'esnext',
    minify: false,
    ssr: 'src/edge.ts',
    rollupOptions: {
      output: {
        entryFileNames: 'edge.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        format: 'es',
      },
    },
  },
  ssr: {
    target: 'webworker',
  },
});
