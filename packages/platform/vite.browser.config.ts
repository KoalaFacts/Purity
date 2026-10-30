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
      entry: {
        actions: 'src/actions.ts',
        signals: 'src/browser-signals/index.ts',
        query: 'src/query-entry.ts',
        islands: 'src/islands.ts',
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
    },
    rolldownOptions: {
      external: (id) => id.startsWith('@purityjs/') && id !== '@purityjs/core/ssr-bridge',
      treeshake: { moduleSideEffects: (id) => id !== '@purityjs/core/ssr-bridge' },
      output: { exports: 'named' },
    },
    sourcemap: true,
  },
});
