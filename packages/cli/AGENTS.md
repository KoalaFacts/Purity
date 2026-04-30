# @purityjs/cli — AI Agent Context

Scaffolding CLI for Purity projects.

## Usage

```bash
npx @purityjs/cli my-app
cd my-app && npm install && npm run dev
```

## Generates

```
my-app/
  package.json        @purityjs/core + @purityjs/vite-plugin + vite + typescript
  vite.config.ts      purity() plugin pre-configured
  tsconfig.json       ES2022, strict, bundler resolution
  index.html          entry with #app div
  src/main.ts         counter component example
  .gitignore          node_modules, dist
```

## Monorepo Support

Auto-detects local packages and uses file: deps + vite aliases.
