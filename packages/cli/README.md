# @purityjs/cli

Scaffold a new Purity project in seconds.

## Usage

```bash
vp dlx @purityjs/cli my-app
cd my-app
vp install
vp dev
```

## What It Generates

```
my-app/
  index.html          — entry HTML
  package.json        — dependencies + scripts
  tsconfig.json       — TypeScript config
  vite.config.ts      — Vite+ + @purityjs/vite-plugin
  .gitignore
  src/
    main.ts           — counter component example
```

### Generated vite.config.ts

```ts
import { purity } from "@purityjs/vite-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [purity()],
});
```

### Generated main.ts

A working counter component demonstrating `state`, `compute`, `html`, `css`, `component`, and `onMount`.

## Scripts

| Command      | Description                  |
| ------------ | ---------------------------- |
| `vp dev`     | Start the Vite+ dev server   |
| `vp build`   | Production build with AOT    |
| `vp preview` | Preview the production build |

## Local Development

When run from the Purity monorepo, the CLI automatically:

- Links `@purityjs/core` to the local source
- Links `@purityjs/vite-plugin` to the local source
- Generates a `vite.config.ts` with resolve aliases

No need to publish packages for local development.

## License

MIT
