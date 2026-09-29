import { defineConfig } from 'vite';

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
      entry: 'src/index.ts',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
    },
    rolldownOptions: {
      // Externalize @purityjs subpaths AND Node built-ins (node:fs, node:path)
      // — the latter must not be inlined or `node:fs.readFileSync` would
      // come from a stub module instead of the real Node API. Failure mode:
      // `(0, r.resolve) is not a function` at plugin load.
      // Also externalize `oxc-parser` (ADR 0035) — it's a real runtime dep
      // that pulls in platform-specific native bindings; inlining trips on
      // the unresolvable `@oxc-parser/binding-wasm32-wasi` fallback path.
      external: [/^@purityjs\//, /^node:/, 'oxc-parser', /^@oxc-parser\//],
      output: {
        exports: 'named',
      },
    },
    sourcemap: true,
  },
});
