# Purity Monorepo — AI Agent Context

Minimal web framework. 21 functions. ~5.8 kB gzipped. TC39-Signals-inspired reactivity.

## Packages

- `@purityjs/core` — the framework → [AGENTS.md](./packages/core/AGENTS.md)
- `@purityjs/vite-plugin` — AOT compilation → [AGENTS.md](./packages/vite-plugin/AGENTS.md)
- `@purityjs/cli` — project scaffolding → [AGENTS.md](./packages/cli/AGENTS.md)

## Quick Start

```bash
npx @purityjs/cli my-app && cd my-app && npm install && npm run dev
```

## Commands

```bash
npm test --workspaces     # all tests
npm run check:fix         # format + lint (Vite+: oxfmt + oxlint)
```
