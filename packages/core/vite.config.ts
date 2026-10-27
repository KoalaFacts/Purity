import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
  },
  build: {
    lib: {
      entry: {
        'jit/index': 'src/compiler/jit.ts',
        'jit-client/index': 'src/compiler/client.ts',
        'runtime/index': 'src/compiler/runtime.ts',
        'compiler/index': 'src/compiler/index.ts',
        'internal/index': 'src/internal.ts',
        'signals/index': 'src/browser-signals/index.ts',
        'router/index': 'src/router/index.ts',
        'actions/index': 'src/actions/index.ts',
        'islands/index': 'src/islands/index.ts',
        'query/index': 'src/query/index.ts',
        'list-runtime/index': 'src/control/list-runtime.ts',
        index: 'src/index.ts',
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => (format === 'es' ? `${entryName}.js` : `${entryName}.cjs`),
    },
    sourcemap: true,
  },
});
