import { resolve } from "node:path";
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@purityjs/agent-types": resolve(import.meta.dirname, "../agent-types/src/index.ts"),
    },
  },
});
