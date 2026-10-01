# Purity Monorepo — AI Agent Context

Minimal web framework with TC39-Signals-inspired reactivity. See
[`docs/framework-capabilities.md`](./docs/framework-capabilities.md) for the
audited feature state; bundle and framework-comparison figures require a fresh
measurement.

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
npm test                  # all workspace test scripts
npm run check:fix         # format + lint (Vite+: oxfmt + oxlint)
```
