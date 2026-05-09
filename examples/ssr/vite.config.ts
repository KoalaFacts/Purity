import { resolve } from 'node:path';
import { purity } from '@purityjs/vite-plugin';
import { defineConfig } from 'vite';

// SSR demo — both client and server builds use this config. The server build
// is invoked separately via `vite build --ssr src/entry.server.ts`. The
// resolve aliases let the example consume the workspace packages from source
// (matching the dashboard demo's pattern), so a single `npm install` is
// enough to bootstrap.
export default defineConfig({
  plugins: [purity()],
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
