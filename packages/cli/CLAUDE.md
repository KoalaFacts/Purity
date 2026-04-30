# @purityjs/cli

Project scaffolding CLI for Purity.

## Usage

```bash
npx @purityjs/cli my-app
```

## File Layout

```
src/
  index.ts    — CLI entry point, scaffolding logic (built to dist/index.js by vite)
```

`bin.purity` in package.json points at `./dist/index.js`. Zero runtime deps.

## What It Generates

- package.json (deps: @purityjs/core, devDeps: @purityjs/vite-plugin, vite, typescript)
- vite.config.ts (with purity() plugin)
- tsconfig.json
- index.html
- src/main.ts (counter example)
- .gitignore

## Local Development Detection

When run from the monorepo, auto-detects and:

- Uses `file:` dependency for @purityjs/core
- Uses `file:` dependency for @purityjs/vite-plugin
- Generates vite.config.ts with resolve aliases to local source

## Key Variables

- `isLocal` — true when running from monorepo
- `coreDir` — path to packages/core/
- `pluginDir` — path to packages/vite-plugin/
