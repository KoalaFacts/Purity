import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: { clearMocks: false },
  build: {
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
    rolldownOptions: { external: [/^@purityjs\//], output: { exports: 'named' } },
    sourcemap: true,
  },
});
