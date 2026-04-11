import { defineConfig } from "vite-plus";

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        "compiler/index": "src/compiler/index.ts",
      },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => (format === "es" ? `${entryName}.js` : `${entryName}.cjs`),
    },
    rolldownOptions: {
      external: ["signal-polyfill"],
    },
    sourcemap: true,
  },
});
