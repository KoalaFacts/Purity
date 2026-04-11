# @purityjs/vite-plugin — Gemini Context

Vite+ plugin setup for AOT template compilation. Transforms `html` tagged templates at build time.

## Install & Setup

```bash
vp add -D @purityjs/vite-plugin vite-plus vite@npm:@voidzero-dev/vite-plus-core@latest
```

```ts
import { purity } from "@purityjs/vite-plugin";
import { defineConfig } from "vite-plus";
export default defineConfig({ plugins: [purity()] });
```

## Before/After

|                | Without           | With       |
| -------------- | ----------------- | ---------- |
| Bundle         | 8.13 kB gz        | 6.02 kB gz |
| CSP            | needs unsafe-eval | safe       |
| Runtime parser | yes               | no         |
