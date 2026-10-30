import { defineConfig } from 'vite-plus';
import base from './vite.config.ts';

// All browser entry points share this build so hooks and ownership state are
// shared even when an application imports multiple core subpaths.
export default defineConfig({
  ...base,
  define: { __SSR__: 'false' },
  build: {
    ...base.build,
    outDir: 'dist/browser',
  },
});
