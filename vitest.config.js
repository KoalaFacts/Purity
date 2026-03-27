import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    port: 6767,
  },
  test: {
    environment: 'jsdom',
  },
});
