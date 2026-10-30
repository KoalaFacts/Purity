import { defineConfig } from 'vite-plus';

export default defineConfig({
  define: { __SSR__: 'false' },
  plugins: [
    {
      name: 'purity-browser-ssr-stub',
      resolveId(id) {
        return id === '@purityjs/core/ssr-bridge' ? '\0purity-browser-ssr' : null;
      },
      load(id) {
        return id === '\0purity-browser-ssr'
          ? 'export const getSSRRenderContext = () => null; export const ssrMarkup = undefined;'
          : null;
      },
    },
  ],
  build: {
    outDir: 'dist/browser',
    lib: {
      entry: 'src/index.ts',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
    },
    rolldownOptions: {
      external: (id) => id.startsWith('@purityjs/') && id !== '@purityjs/core/ssr-bridge',
      treeshake: { moduleSideEffects: (id) => id !== '@purityjs/core/ssr-bridge' },
      output: { exports: 'named' },
    },
    sourcemap: true,
  },
});
