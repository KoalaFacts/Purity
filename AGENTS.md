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

The canonical repository guide for agents is [CLAUDE.md](./CLAUDE.md) (package table, architecture, commands, conventions). Package guides:

- `@purityjs/core` — templates, components, control flow, resources, hydration → [CLAUDE.md](./packages/core/CLAUDE.md)
- `@purityjs/signals` — reactive graph → [README](./packages/signals/README.md)
- `@purityjs/compiler` — parser and code generators → [README](./packages/compiler/README.md)
- `@purityjs/ssr` — server rendering → [README](./packages/ssr/README.md)
- `@purityjs/router` — routing → [README](./packages/router/README.md)
- `@purityjs/platform` — browser signals, query, actions, islands → [README](./packages/platform/README.md)
- `@purityjs/vite-plugin` — AOT compile and build transforms → [CLAUDE.md](./packages/vite-plugin/CLAUDE.md)
- `@purityjs/cli` — project scaffolding → [CLAUDE.md](./packages/cli/CLAUDE.md)

## Quick Start

```bash
npx @purityjs/cli my-app && cd my-app && npm install && npm run dev
```

## Commands

```bash
npm test                  # all workspace test scripts
npm run check:fix         # format + lint (Vite+: oxfmt + oxlint)
```
