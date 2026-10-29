import { resolve } from 'node:path';
import { defineConfig, mergeConfig } from 'vite';
import counter from './vite.config.ts';

// Separate output preserves the original single-counter build and its scope.
export default mergeConfig(
  counter,
  defineConfig({
    build: {
      outDir: 'dist-workloads',
      rollupOptions: {
        input: {
          rows: resolve(import.meta.dirname, 'rows.html'),
          binding: resolve(import.meta.dirname, 'binding.html'),
        },
      },
    },
  }),
);
