# Purity Monorepo

Minimal web framework built on TC39-Signals-inspired reactivity. 21 functions. ~5.8 kB gzipped. Optional SSR via Declarative Shadow DOM.

## Packages

| Package                 | Path                    | Docs                                          |
| ----------------------- | ----------------------- | --------------------------------------------- |
| `@purityjs/core`        | `packages/core/`        | [CLAUDE.md](./packages/core/CLAUDE.md)        |
| `@purityjs/ssr`         | `packages/ssr/`         | server-side rendering — `renderToString`, DSD |
| `@purityjs/vite-plugin` | `packages/vite-plugin/` | [CLAUDE.md](./packages/vite-plugin/CLAUDE.md) |
| `@purityjs/cli`         | `packages/cli/`         | [CLAUDE.md](./packages/cli/CLAUDE.md)         |

## SSR architecture (high-level)

- Compiler emits two modes — `generate` (DOM) for client, `generateSSR` (string) for server. Both share the same parser + AST.
- Custom elements with `component()` SSR via `<template shadowrootmode="open">` (Declarative Shadow DOM).
- `resource()` hooks an SSRRenderContext to await pending fetches across two render passes; resolved values are embedded as `<script id="__purity_resources__">` JSON for the client.
- `hydrate()` is currently lossy (clear + remount). The `<!--[--><!--]-->` hydration markers are emitted in preparation for a marker-walking follow-up.
- The Vite plugin reads its `transform(code, id, opts)` third argument and switches codegen when `opts.ssr === true`.

## Commands

```bash
npm test --workspaces          # all tests
npm test -w packages/core      # core only
npm run check                  # format check + lint (Vite+: oxfmt + oxlint)
npm run check:fix              # auto-fix formatting and lint
```

## Zero runtime dependencies (custom push-pull reactivity in `packages/core/src/signals.ts`)

See each package's CLAUDE.md for detailed API, file layout, and skills.
