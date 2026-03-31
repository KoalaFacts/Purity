import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    rolldownOptions: {
      input: 'index.html',
    },
  },
});
