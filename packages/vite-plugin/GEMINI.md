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

|                | Without           | With successful AOT |
| -------------- | ----------------- | ------------------- |
| CSP            | needs unsafe-eval | safe                |
| Runtime parser | yes               | no                  |

The CSP and parser comparison assumes the relevant templates compile successfully;
compiler warnings can leave a template on the runtime path.

Bundle savings depend on the application; compare production builds of the
same app with and without the plugin. See [the capability audit](../../docs/framework-capabilities.md).
