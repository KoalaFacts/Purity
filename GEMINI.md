# Purity Monorepo — Gemini Context

Minimal web framework. See [the capability audit](./docs/framework-capabilities.md)
for implemented features and remaining work. Measure bundle size on the current
application build before quoting figures.

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
