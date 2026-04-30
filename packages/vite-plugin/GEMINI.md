# @purityjs/vite-plugin — Gemini Context

Vite plugin for AOT template compilation. Transforms `html` tagged templates at build time.

## Install & Setup

```bash
npm install -D @purityjs/vite-plugin
```

```ts
import { purity } from '@purityjs/vite-plugin';
export default defineConfig({ plugins: [purity()] });
```

## Before/After

|                | Without           | With       |
| -------------- | ----------------- | ---------- |
| Bundle         | 8.13 kB gz        | 6.02 kB gz |
| CSP            | needs unsafe-eval | safe       |
| Runtime parser | yes               | no         |
