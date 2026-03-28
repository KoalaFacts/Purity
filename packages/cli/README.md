# @purity/cli

Scaffold a new Purity project in seconds.

## Usage

```bash
npx @purity/cli my-app
cd my-app
npm install
npm run dev
```

## What It Generates

```
my-app/
  index.html          — entry HTML
  package.json        — dependencies + scripts
  tsconfig.json       — TypeScript config
  vite.config.ts      — Vite + @purity/vite-plugin
  .gitignore
  src/
    main.ts           — counter component example
```

### Generated vite.config.ts

```ts
import { purity } from '@purity/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [purity()],
});
```

### Generated main.ts

A working counter component demonstrating `state`, `compute`, `html`, `css`, `component`, and `onMount`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build with AOT |
| `npm run preview` | Preview production build |

## Local Development

When run from the Purity monorepo, the CLI automatically:
- Links `@purity/core` to the local source
- Links `@purity/vite-plugin` to the local source
- Generates a `vite.config.ts` with resolve aliases

No need to publish packages for local development.

## License

MIT
