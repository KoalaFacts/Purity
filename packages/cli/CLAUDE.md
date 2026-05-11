# @purityjs/cli

Project scaffolding CLI for Purity.

## Usage

```bash
npx @purityjs/cli my-app          # client-only
npx @purityjs/cli my-app --ssr    # SSR + hydration
```

## File Layout

```
src/
  index.ts    — CLI entry point, scaffolding logic (built to dist/index.js by vite)
```

`bin.purity` in package.json points at `./dist/index.js`. Zero runtime deps.

## What It Generates

**Client-only** (default):

- package.json (deps: @purityjs/core, devDeps: @purityjs/vite-plugin, vite, typescript)
- vite.config.ts (with purity() plugin)
- tsconfig.json
- index.html
- src/main.ts (counter example)
- .gitignore

**SSR (`--ssr`):**

- package.json (adds @purityjs/ssr dep, @types/node devDep, build:client/build:server/preview scripts)
- vite.config.ts with `@purityjs/core/compiler` + `@purityjs/ssr` aliases for monorepo-local development
- tsconfig.json with `types: ['node']` and `allowImportingTsExtensions`
- index.html with `<!--ssr-outlet-->` marker
- src/app.ts (shared by client + server)
- src/entry.client.ts (calls `hydrate()`)
- src/entry.server.ts (exports `render(url)`)
- server.ts (zero-dep Node SSR server, run via `node --experimental-strip-types server.ts`)

## Local Development Detection

When run from the monorepo, auto-detects and:

- Uses `file:` dependency for @purityjs/core
- Uses `file:` dependency for @purityjs/vite-plugin
- Generates vite.config.ts with resolve aliases to local source

## Key Variables

- `isLocal` — true when running from monorepo
- `coreDir` — path to packages/core/
- `pluginDir` — path to packages/vite-plugin/
