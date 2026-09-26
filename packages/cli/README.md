# @purityjs/cli

[![npm version](https://img.shields.io/npm/v/@purityjs/cli.svg)](https://www.npmjs.com/package/@purityjs/cli)
[![npm downloads](https://img.shields.io/npm/dm/@purityjs/cli.svg)](https://www.npmjs.com/package/@purityjs/cli)
[![license](https://img.shields.io/npm/l/@purityjs/cli.svg)](../../LICENSE)

Scaffold a new Purity project in seconds.

## Usage

```bash
npx @purityjs/cli my-app
cd my-app
npm install
npm run dev
```

For a server-rendered project, add `--ssr` when creating it. After building,
`npm run preview` starts a Node server that renders pages and serves client
assets. Set `PORT` to change the default port of 3000.

```bash
npx @purityjs/cli my-ssr-app --ssr
cd my-ssr-app
npm install
npm run build
npm run preview
```

## What It Generates

```
my-app/
  index.html          — entry HTML
  package.json        — dependencies + scripts
  tsconfig.json       — TypeScript config
  vite.config.ts      — Vite + @purityjs/vite-plugin
  .gitignore
  src/
    main.ts           — counter component example
```

### Generated vite.config.ts

```ts
import { purity } from '@purityjs/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [purity()],
});
```

### Generated main.ts

A working counter component demonstrating `state`, `compute`, `html`, `css`, `component`, and `onMount`.

## Scripts

| Command             | Description                   |
| ------------------- | ----------------------------- |
| `npm run dev`       | Start Vite dev server         |
| `npm run typecheck` | Check TypeScript types        |
| `npm run build`     | Type-check and build with AOT |
| `npm run preview`   | Preview production build      |

## Local Development

When run from the Purity monorepo, the CLI automatically:

- Links `@purityjs/core` to the local source
- Links `@purityjs/vite-plugin` to the local source
- Generates a `vite.config.ts` with resolve aliases

No need to publish packages for local development.

## License

MIT
