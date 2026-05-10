# Purity Monorepo

Minimal web framework built on TC39-Signals-inspired reactivity. 21 functions. ~5.8 kB gzipped. Optional SSR via Declarative Shadow DOM.

## Packages

| Package                 | Path                    | Docs                                                             |
| ----------------------- | ----------------------- | ---------------------------------------------------------------- |
| `@purityjs/core`        | `packages/core/`        | [CLAUDE.md](./packages/core/CLAUDE.md)                           |
| `@purityjs/ssr`         | `packages/ssr/`         | SSR — `renderToString` + `renderToStream` + `renderStatic` + DSD |
| `@purityjs/vite-plugin` | `packages/vite-plugin/` | [CLAUDE.md](./packages/vite-plugin/CLAUDE.md)                    |
| `@purityjs/cli`         | `packages/cli/`         | [CLAUDE.md](./packages/cli/CLAUDE.md)                            |

## SSR architecture (high-level)

- Compiler emits three modes — `generate` (DOM) for client, `generateSSR` (string) for server, `generateHydrate` (walks SSR DOM, attaches bindings) for hydration. All three share the same parser + AST.
- Custom elements with `component()` SSR via `<template shadowrootmode="open">` (Declarative Shadow DOM).
- `resource()` hooks an SSRRenderContext to await pending fetches across two render passes; resolved values are embedded as `<script id="__purity_resources__">` JSON for the client.
- `hydrate()` walks `<!--[--><!--]-->` marker pairs and attaches bindings to the existing SSR nodes (no rebuild). Nested templates inflate via a deferred-template thunk; DSD-aware Custom Elements hydrate their own shadow content. Opt-in `enableHydrationWarnings()` logs structural mismatches, and the hydrator catches walker failures and falls back to a fresh `mount()`. Control-flow helpers hydrate losslessly: `each()` rows via `<!--er:K-->row<!--/er-->` per-row markers + `inflateDeferredEach`, and `when()` / `match()` via `<!--m:KEY-->...<!--/m-->` boundary markers + `inflateDeferredMatch` (which seeds the per-case DOM cache so toggling back to the SSR key reuses adopted nodes). See ADR [0005](./docs/decisions/0005-non-lossy-hydration.md).
- ADR [0006](./docs/decisions/0006-streaming-suspense.md) (Proposed) sketches `suspense(view, fallback)` + `renderToStream` for progressive rendering. Phases 1, 2, 3, 5, 6 are shipped: `renderToStream` returns a `ReadableStream<Uint8Array>` that flushes the shell with each boundary's fallback, then drains streamed boundary chunks (`<template id="purity-s-N">…</template><script id="__purity_resources_N__">{"keyed":...}</script><script>__purity_swap(N)</script>`) in declaration order. The `__purity_swap` helper is inlined exactly once after the shell. The client-side hydrate priming merges every `script[id^="__purity_resources_"]` payload into the keyed cache. Phase 4 (adapter examples) remains.
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
