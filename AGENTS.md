# Purity Monorepo — AI Agent Context

Minimal web framework. 17 functions. 6 kB gzipped. Native TC39 Signals.

## Packages
- `@purity/core` — the framework → [AGENTS.md](./packages/core/AGENTS.md)
- `@purity/vite-plugin` — AOT compilation → [AGENTS.md](./packages/vite-plugin/AGENTS.md)
- `@purity/cli` — project scaffolding → [AGENTS.md](./packages/cli/AGENTS.md)

## Quick Start
```bash
npx @purity/cli my-app && cd my-app && npm install && npm run dev
```

## Commands
```bash
npm test --workspaces     # all tests
npx biome check --write . # format + lint
```
