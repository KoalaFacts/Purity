import { defineConfig } from 'vite';

export default defineConfig({
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
      external: [/^@purityjs\//, /^node:/],
      output: {
        exports: 'named',
      },
    },
    sourcemap: true,
  },
});
