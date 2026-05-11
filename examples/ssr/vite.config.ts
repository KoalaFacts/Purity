import { resolve } from 'node:path';
import { purity } from '@purityjs/vite-plugin';
import { defineConfig } from 'vite';

// SSR demo — both client and server builds use this config. The server build
// is invoked separately via `vite build --ssr src/entry.server.ts`. The
// resolve aliases let the example consume the workspace packages from source
// (matching the dashboard demo's pattern), so a single `npm install` is
// enough to bootstrap.
// `routes: { dir: 'src/pages' }` enables the file-system route manifest
// (ADRs 0019-0022). The plugin scans pages/ at dev/build time and exposes
// the manifest via the virtual `purity:routes` module that `src/app.ts`
// imports.
export default defineConfig({
  plugins: [purity({ routes: { dir: 'src/pages' } })],
  resolve: {
    alias: {
      // Order matters: longer / more-specific subpath aliases must come
      // before their parent prefix or the parent will eagerly capture them.
      '@purityjs/core/compiler': resolve(
        import.meta.dirname,
        '../../packages/core/src/compiler/index.ts',
      ),
      '@purityjs/core': resolve(import.meta.dirname, '../../packages/core/src/index.ts'),
      '@purityjs/ssr': resolve(import.meta.dirname, '../../packages/ssr/src/index.ts'),
    },
  },
  build: {
    minify: false,
  },
});
