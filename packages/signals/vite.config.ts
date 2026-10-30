import { defineConfig } from 'vite-plus';

export default defineConfig({
  define: {
    'process.env.NODE_ENV': '"development"',
  },
  test: { clearMocks: false },
  build: {
    lib: {
      entry: {
        index: 'src/index.ts',
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => (format === 'es' ? `${entryName}.js` : `${entryName}.cjs`),
    },
    sourcemap: true,
  },
});
