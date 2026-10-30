import { resolve } from 'node:path';
import { purity } from '@purityjs/vite-plugin';
import { defineConfig } from 'vite-plus';

// SSR demo — both client and server builds use this config. The server build
// is invoked separately via `vite build --ssr src/entry.server.ts`. The
// resolve aliases let the example consume the workspace packages from source
// (matching the dashboard demo's pattern), so a single `npm install` is
// enough to bootstrap.
// `routes: { dir: 'src/pages' }` enables the file-system route manifest
// (ADRs 0019-0022). The plugin scans pages/ at dev/build time and exposes
// the manifest via the virtual `purity:routes` module that `src/app.ts`
// imports. `emitTo: 'src/.purity/routes.ts'` (ADR 0032) also writes the
// generated source to disk so `tsc` + IDE jump-to-definition work without
// an ambient declaration. Gitignore the emit path.
export default defineConfig({
  plugins: [
    purity({ hydratable: true, routes: { dir: 'src/pages', emitTo: 'src/.purity/routes.ts' } }),
  ],
  resolve: {
    alias: {
      // Order matters: longer / more-specific subpath aliases must come
      // before their parent prefix or the parent will eagerly capture them.
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
    minify: false,
  },
});
