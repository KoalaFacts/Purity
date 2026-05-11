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

- Compiler emits three modes — `generate` (DOM) for client, `generateSSR` (string) for server, `generateHydrate` (walks SSR DOM, attaches bindings) for hydration. All three share the same parser + AST.
- Custom elements with `component()` SSR via `<template shadowrootmode="open">` (Declarative Shadow DOM).
- `resource()` hooks an SSRRenderContext to await pending fetches across two render passes; resolved values are embedded as `<script id="__purity_resources__">` JSON for the client.
- `hydrate()` walks `<!--[--><!--]-->` marker pairs and attaches bindings to the existing SSR nodes (no rebuild). Nested templates inflate via a deferred-template thunk; DSD-aware Custom Elements hydrate their own shadow content. Opt-in `enableHydrationWarnings()` logs structural mismatches, and the hydrator catches walker failures and falls back to a fresh `mount()`. See ADR [0005](./docs/decisions/0005-non-lossy-hydration.md).
- ADR [0006](./docs/decisions/0006-streaming-suspense.md) (Proposed) sketches `suspense(view, fallback)` + `renderToStream` for progressive rendering.
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
