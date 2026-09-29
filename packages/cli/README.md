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
`npm start` runs the generated JavaScript server, which renders pages and
serves client assets. Set `PORT` to change the default port of 3000.

```bash
npx @purityjs/cli my-ssr-app --ssr
cd my-ssr-app
npm install
npm run build
npm start
```

For an app that chooses static HTML, per-request HTML, or browser rendering
per page, use `--app`:

```bash
npx @purityjs/cli my-site --app
cd my-site
npm install
npm run build
npm start
```

Set `renderMode` in each `src/pages/` module to `static`, `server`, or
`client`. Dynamic static pages list their paths in `src/static-paths.ts`, which
only runs during the build. `dist/client/` holds generated HTML and client
assets; `dist/server.js` serves the complete app. Server pages stream deferred
`suspense()` content after the shell while preserving loader status, headers,
and `head()` content. A fully static app can deploy
`dist/client/` to a static host. See the generated README for details.

On a Node 24+ host, deploy the generated project and run `npm ci`,
`npm run build`, then `npm start`. If building before deployment, copy `dist/`,
`package.json`, and `package-lock.json` to the host and run
`npm ci --omit=dev` followed by `npm start`. The generated README has these
steps too. `npm run preview` remains a local alias for the SSR start command.

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
| `npm start` (SSR)   | Run the built Node server     |
| `npm start` (app)   | Serve all app rendering modes |

## Local Development

When run from the Purity monorepo, the CLI automatically:

- Links `@purityjs/core` to the local source
- Links `@purityjs/vite-plugin` to the local source
- Generates a `vite.config.ts` with resolve aliases

No need to publish packages for local development.

## License

MIT
