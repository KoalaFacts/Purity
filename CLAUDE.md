# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Purity Monorepo

Minimal web framework built on TC39-Signals-inspired reactivity. Templates compile to direct DOM operations — no virtual DOM. The core has zero runtime dependencies; optional SSR lives in `@purityjs/ssr`. Purity is pre-1.0; read package manifests for the checkout version. See [the capability audit](./docs/framework-capabilities.md) before quoting feature, bundle-size, or framework-comparison claims.

## Packages

| Package                 | Path                    | Role                                                                                        | Docs                                          |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `@purityjs/signals`     | `packages/signals/`     | Reactive graph — `state`, `compute`, `watch`, `batch`, scopes, `debounced`                  | [README](./packages/signals/README.md)        |
| `@purityjs/compiler`    | `packages/compiler/`    | Template parser, AST and the three code generators                                          | [README](./packages/compiler/README.md)       |
| `@purityjs/core`        | `packages/core/`        | Templates (JIT), components, control flow, resources, forms, virtual lists, hydration       | [CLAUDE.md](./packages/core/CLAUDE.md)        |
| `@purityjs/ssr`         | `packages/ssr/`         | Node-only SSR — `renderToString` + `renderToStream` + `renderStatic` + DSD                  | [README](./packages/ssr/README.md)            |
| `@purityjs/router`      | `packages/router/`      | Navigation primitives, async routes, loaders, head/title management                         | [README](./packages/router/README.md)         |
| `@purityjs/platform`    | `packages/platform/`    | Browser/live-data signals, `query`, `optimistic`, server actions, form enhancement, islands | [README](./packages/platform/README.md)       |
| `@purityjs/vite-plugin` | `packages/vite-plugin/` | AOT template compile + server-module strip + file-system routing                            | [CLAUDE.md](./packages/vite-plugin/CLAUDE.md) |
| `@purityjs/cli`         | `packages/cli/`         | Project scaffolding (`--ssr`, `--app`)                                                      | [CLAUDE.md](./packages/cli/CLAUDE.md)         |

Each package's CLAUDE.md (or README) carries the detailed API, file layout, and conventions. **Read the relevant package CLAUDE.md before editing inside that package** — they are the source of truth for per-package detail; this file is the cross-cutting big picture.

## Repo layout

- `packages/*` — the eight published packages above.
- `examples/*` — runnable apps, each a workspace: `dashboard` (polling demo), `docs-site` (the public docs site), `islands-blog`, `ssr`, and three streaming-SSR adapter examples (`ssr-stream-cf-workers`, `ssr-stream-deno`, `ssr-stream-vercel-edge`).
- `benchmark/` — headless-Chromium runtime benchmarks (18 scenarios) plus Node heap-diff tools; published to GitHub Pages.
- `docs/` — long-form guides (`typescript.md`, `islands.md`, `shadow-dom-rationale.md`, `accessibility.md`, `migration.md`, `debugging.md`), **`docs/decisions/`**, the ADR log (`NNNN-title.md`, indexed in its README), and the active plan ledger [`docs/plans/surpass-solid.md`](./docs/plans/surpass-solid.md). [`docs/README.md`](./docs/README.md) indexes every doc. Nearly every feature traces to an ADR — when changing behavior, find and update the corresponding ADR; when adding one, follow the existing numbering.

## Architecture (the big picture)

### Reactivity (`packages/signals/src/signals.ts`)

A custom push-pull signal graph inspired by the TC39 Signals proposal (Stage 1) — **not** a polyfill. `state` / `compute` / `watch` / `batch` are the primitives; everything else (resources, control flow, the large library of observer/environment/capability/live-data signals) is layered on top. This file has zero dependencies and is the hot path — preserve its style (index loops not for-of, nullable arrays, lazy `??=` init).

### Compiler — three codegen modes from one parser/AST

The template compiler (`packages/compiler/src/`, published as `@purityjs/compiler`) parses each `html` template literal once into an AST, then emits one of three modes that **must stay behaviorally aligned**:

- `generate` — direct `document.createElement` DOM code, for the client.
- `generateSSR` — string-builder factories, for the server.
- `generateHydrate` — walks the existing SSR DOM and attaches bindings in place (no rebuild).

`html` works two ways: JIT at runtime (`packages/core/src/compiler/compile.ts`, WeakMap-cached) or AOT via `@purityjs/vite-plugin`, which extracts every `html` template at build time, replaces it with compiled output, and strips `html` from imports (CSP-safe — no `eval` / `new Function`). The compiler is its own package, **`@purityjs/compiler`**, so the Vite plugin imports it without pulling in runtime code. The plugin switches between DOM and SSR codegen on its `transform(code, id, opts)` third arg (`opts.ssr === true`).

### SSR + hydration

- Custom elements (`component()`) SSR as `<template shadowrootmode="open">` (Declarative Shadow DOM) so the browser parses a real shadow tree before any JS loads.
- `resource()` hooks an `SSRRenderContext` to await pending fetches across two render passes; resolved values are embedded as a `<script id="__purity_resources__">` JSON payload that `hydrate()` reads to skip the first refetch.
- `hydrate()` walks `<!--[-->...<!--]-->` marker pairs and attaches bindings to existing SSR nodes (no rebuild). Hydration is **non-lossy** (ADR [0005](./docs/decisions/0005-non-lossy-hydration.md)): nested templates inflate via a deferred-template thunk; control flow hydrates losslessly via per-row `<!--er:K-->row<!--/er-->` markers (`each`) and `<!--m:KEY-->...<!--/m-->` boundary markers (`when`/`match`). Opt-in `enableHydrationWarnings()` logs structural mismatches; `enableHydrationTextRewrite()` (ADR 0007) self-heals static-text drift. On any walker failure the hydrator falls back to a fresh `mount()`, so a divergent SSR never crashes the page.
- Streaming (ADR [0006](./docs/decisions/0006-streaming-suspense.md)): `renderToStream` returns a `ReadableStream<Uint8Array>` that flushes the shell with each `suspense()` boundary's fallback, then drains boundary chunks (`<template id="purity-s-N">…</template><script id="__purity_resources_N__">…</script><script>__purity_swap(N)</script>`) in declaration order. The `__purity_swap` helper is inlined once after the shell; the client hydrate priming merges every `script[id^="__purity_resources_"]` payload into the keyed cache.

### Vite plugin — security-relevant build transforms

Beyond AOT compilation, the plugin keeps server code out of the browser bundle: it replaces `*.server.{ts,js,tsx,jsx}` modules with `export {};` in client builds (ADR 0018), strips inline `serverAction(url, handler)` handler bodies via `oxc-parser` in ordinary files (ADR 0043), and exposes opt-in file-system routing (`routes` option → virtual `purity:routes` module, ADR 0019) with layouts, error boundaries, data-loader detection, and a sibling `routes.d.ts` typing surface. Client SSR detection is `opts.ssr !== true`.

## Verifying a change

Before claiming a change works, follow `.claude/skills/verification-first/SKILL.md` and exercise the affected rows of `.claude/skills/verify-purity/SKILL.md` (built packages in headless Chromium, SSR then hydration, CLI scaffold, benchmark against Solid); keep that feature map current when a feature changes.

## Commands

```bash
npm test --workspaces           # all tests
npm test -w packages/core       # one package
npm run build                   # build all packages
npm run check                   # format check + lint (oxfmt + oxlint, --deny-warnings)
npm run check:fix               # auto-fix formatting and lint
npm run typecheck               # tsc over src + tests (packages with a tsconfig.tests.json)

# Single test / file (run from the package dir, e.g. packages/core):
npx vitest run tests/resource.test.ts      # one file
npx vitest run -t "aborts in-flight"       # by test-name pattern
npm run bench -w packages/core             # vitest micro-benchmarks
```

- **Node >= 24** required (`.nvmrc` pins `24`; tooling uses native TS strip + `--conditions=development`).
- Tooling is **oxfmt + oxlint** (via `vite-plus`), not Prettier/ESLint. `check` runs `--deny-warnings`, so warnings fail CI — run `check:fix` before pushing.
- Tests run on **vitest + jsdom**. For async signal updates use `const tick = () => new Promise(r => queueMicrotask(r))`.

## Conventions

- Match the style of `signals.ts` in hot paths: index loops over for-of, nullable arrays (null when empty), lazy `??=` init. oxfmt enforces 2-space indent, single quotes, trailing commas.
- `console.error` on real errors — never silently swallow a catch.
- Keep the three compiler codegen modes in lockstep: a template feature added to `generate` needs matching `generateSSR` + `generateHydrate` support (and usually a hydration marker), or hydration diverges.
- Behavioral changes should reference/update the matching ADR in `docs/decisions/`.
