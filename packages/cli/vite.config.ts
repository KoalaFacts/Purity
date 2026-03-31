import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rolldownOptions: {
      external: [/^node:/],
      output: {
        banner: '#!/usr/bin/env node',
      },
    },
    sourcemap: true,
  },
});
