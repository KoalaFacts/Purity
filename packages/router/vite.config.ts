import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: { clearMocks: false, environment: 'jsdom', maxWorkers: 4 },
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
    },
    rolldownOptions: { external: [/^@purityjs\//], output: { exports: 'named' } },
    sourcemap: true,
  },
});
