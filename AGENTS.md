# Purity Monorepo — AI Agent Context

Minimal web framework with TC39-Signals-inspired reactivity. See
[`docs/framework-capabilities.md`](./docs/framework-capabilities.md) for the
audited feature state; bundle and framework-comparison figures require a fresh
measurement.

For competitive work, use the [Solid v2 gap analysis](./docs/solid-v2-gap-analysis.md)
and [gap ledger](./docs/solid-v2-gaps.json). Name the `SV2-*` gap and executed
before/after evidence in substantive changes; keep bounded fixes separate from
whole-capability acceptance. The pinned v2 target, not v1 API names, is the reference.

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
