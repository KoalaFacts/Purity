# 0004: SSR MVP via Declarative Shadow DOM

**Status:** Accepted
**Date:** 2026-05-09

## Context

ADR [0001](./0001-ssr-strategy.md) committed Purity to "client-rendered
only, by design" for 1.0, with a static-prerender path slated for 1.x
and full SSR explicitly not committed for 2.x. That decision held for
about as long as it took the next session to start: the team chose SSR
(with islands as a follow-up) as the next differentiating feature, an
exploration pass established that the parser, codegen, and reactivity
machinery already factored cleanly into client and server modes, and the
"won't ship for months" cost estimate that drove 0001 turned out to be
wrong for an MVP-quality slice.

The forces 0001 weighed have not changed:

1. **Engineering cost.** Real, but smaller than 0001 estimated. The
   shared parser + AST means the SSR codegen is a parallel emit mode,
   not a fork. Resource awaiting reuses the existing two-phase fetcher
   shape. Hydration was the hardest part — and we settled for a lossy
   MVP rather than the marker-walking design the cost estimate assumed.
2. **Bundle-size discipline.** SSR-only code lives in a separate
   `@purityjs/ssr` package. Hydration adds ~400 bytes to the client
   bundle. The 5.8 kB client pitch is intact.
3. **Custom Elements + Shadow DOM compose poorly with SSR.** Mitigated
   by Declarative Shadow DOM (Chrome 111+, Safari 16.4+, Firefox 123+),
   which is now the modern baseline. Component output is wrapped in
   `<template shadowrootmode="open">` and the browser parses a real
   shadow tree before any JS runs.

## Decision

**For 1.0: Purity ships an SSR MVP.** Concretely:

- **`@purityjs/ssr`** — new server-only package. Public API:
  `renderToString(component, options?): Promise<string>` and the SSR
  variant of the `html\`\`` tag. Components (`component()`) and the
control-flow helpers (`each`/`when`/`match`/`list`) all have
SSR-aware variants (`eachSSR`, `whenSSR`, `matchSSR`, `listSSR`)
exported from `@purityjs/core`.
- **Custom Elements via Declarative Shadow DOM.** Server emits
  `<my-tag><template shadowrootmode="open">…shadow content…</template>
…light slot children…</my-tag>`. The Custom Element constructor
  reuses `this.shadowRoot` if present, so DSD parsing doesn't break
  client hydration.
- **Resource awaiting via two-pass render.** `renderToString` runs the
  component under an `SSRRenderContext`, captures every pending
  resource promise, awaits them, then re-renders. Loops until no new
  promises are created or `timeout` (default 5000 ms) elapses.
- **Hydration cache priming.** Resolved resource values are embedded as
  `<script type="application/json" id="__purity_resources__">…</script>`.
  `hydrate()` reads and parses the script, primes a cache, then each
  `resource()` consumes one value as its initial data and skips the
  first refetch — so server data appears immediately, no loading flash.
- **Lossy hydration.** `hydrate()` clears existing children and renders
  fresh via `mount()`. SSR's main UX win — fast initial paint before
  JS loads — is preserved. Matching content produces an invisible
  flash; mismatches produce a visible jump. The
  `<!--[--><!--]-->` hydration markers are emitted in preparation for a
  follow-up that walks them and preserves the existing DOM.
- **Vite plugin SSR mode.** `transform(code, id, opts)` reads
  `opts.ssr === true` and switches `generate` → `generateSSR`, swaps
  the `__purity_w__` (watch) runtime arg for `__purity_h__` (ssrHelpers),
  injects a side-effect `import '@purityjs/ssr'` to register the
  component renderer, and strips `html` from `@purityjs/core` /
  `@purityjs/ssr` imports the same way it does for client builds.
- **CLI scaffold.** `npx @purityjs/cli my-app --ssr` generates the
  full SSR shape: `entry.server.ts`, `entry.client.ts`, `app.ts`,
  zero-dep Node `server.js`, `index.html` with `<!--ssr-outlet-->`,
  package.json with the `build:client` / `build:server` script split.
- **Demo.** `examples/ssr/` exercises the full stack end-to-end.

This decision **supersedes ADR 0001**. The static-prerender path 0001
slated for 1.x is no longer needed — `renderToString` is the more
general primitive and a static-prerender mode is a thin wrapper over
it.

## Out of scope (intentionally)

- **Marker-walking hydration.** Lossy hydration is the MVP. The
  hydration-marker comments are emitted now so a future ADR can
  introduce DOM-preserving hydration without changing SSR output.
- **Streaming SSR / `renderToReadableStream`.** Buffered HTML only.
  Streaming requires a different async model and edge-runtime adapters.
- **Edge runtime adapters.** Cloudflare Workers / Deno Deploy will need
  small wrappers; not in this MVP because no user has asked yet.
- **Named / scoped slot SSR.** Default slot only. Named slots throw a
  clear "not supported in SSR yet" error so users aren't silently
  surprised.
- **Islands / per-component code-splitting.** The whole tree hydrates
  together. Per-island chunking is a separate ADR.
- ~~**User-controllable `resource()` keys.** Cache priming uses
  creation-order indexing.~~ Resolved in a follow-up: pass `{ key: 'todos' }`
  to `resource()` and the SSR payload becomes `{ ordered: [...], keyed:
{...} }`, with the keyed entries surviving conditional/reordered
  creation between server and client. The legacy creation-order
  indexing remains the default (and the array shape is still emitted
  when no resource uses a key).

## Consequences

**Positive:**

- The "no SSR" line in the README is gone. The framework no longer
  loses prospective users on first scroll.
- Same component code runs on Node and in the browser — no isomorphic
  guards in user space.
- DSD avoids the upgrade flash that the alternative "attach shadow at
  hydration time" strategy would introduce.
- `resource()` "just works" server-side. Awaiting fetches and embedding
  resolved data is invisible to the user — the same `resource(...)`
  call powers both modes.
- Bundle pitch is intact. SSR code lives in a separate package; the
  client gains ~400 bytes for `hydrate()`.

**Negative:**

- Lossy hydration means matching SSR/CSR content still triggers a brief
  re-render flash (invisible) and mismatching content shows a visible
  jump. This is worse than React/Solid/Vue's preserve-DOM hydration and
  needs a follow-up ADR + implementation.
- DSD's Chrome 111+/Safari 16.4+/Firefox 123+ floor cuts off pre-2024
  browsers for SSR'd Custom Elements. Pre-DSD browsers see empty
  custom-element hosts until JS runs.
- Resource cache keys default to creation-order, so a render that
  conditionally creates resources (e.g., `if (foo) resource(...)`)
  can shift indices between server and client and serve stale data.
  Users opt in to stable lookups via `resource(..., { key: 'todos' })`
  (added in a follow-up commit), or keep resource creation
  unconditional and accept the cache miss when conditions diverge.
- Named/scoped slot users get a runtime error in SSR. Their components
  silently work in CSR but break the moment they're server-rendered.

**Neutral:**

- The Vite plugin now handles two emit modes. The codegen split was
  small (parallel `generateSSR` + a `_h.element` dispatch hook) but
  the plugin's `transform` hook went from `(code, id)` to
  `(code, id, opts)` which is a public-facing change for anyone who
  wrote integration tests against the plugin directly.

## Implementation summary

Shipped across 6 PRs (commits `4d469b2`..`9712b4a`) plus a polish
commit (`f35ad7e`):

| PR  | Commit    | Scope                                                             |
| --- | --------- | ----------------------------------------------------------------- |
| 1   | `4d469b2` | Compiler `generateSSR` + `eachSSR`/`whenSSR`/`matchSSR`/`listSSR` |
| 2   | `9fc2d83` | `@purityjs/ssr` package with `renderToString` + SSR `html` tag    |
| 3   | `768e6bc` | Component SSR with Declarative Shadow DOM                         |
| 4   | `6906b15` | `hydrate()` + DSD-aware Custom Element lifecycle                  |
| 5   | `2246d4d` | Resource awaiting (two-pass) + hydration cache priming            |
| 6   | `9712b4a` | Vite plugin SSR mode + `examples/ssr` end-to-end demo             |
|     | `f35ad7e` | CLI `--ssr` flag + README / CLAUDE.md updates                     |

**Test count:** 451 core + 52 ssr + 85 vite-plugin = 588 passing.

**Critical files:**

- `packages/core/src/compiler/codegen.ts` — `generateSSR` parallel to `generate`
- `packages/core/src/compiler/ssr-runtime.ts` — `ssrHelpers`, `_h.element` dispatch
- `packages/core/src/elements.ts` — `_renderComponentSSR`, DSD-aware `connectedCallback`
- `packages/core/src/control.ts` — SSR variants of each / when / match / list
- `packages/core/src/resource.ts` — SSR ctx interception + hydration cache consumption
- `packages/core/src/ssr-context.ts` — render-time + hydration cache state
- `packages/core/src/component.ts` — `hydrate()` + cache priming from `<script>`
- `packages/ssr/src/render-to-string.ts` — two-pass loop + JSON payload emission
- `packages/ssr/src/component.ts` — registers `_renderComponentSSR` hook
- `packages/vite-plugin/src/index.ts` — reads `opts.ssr`, switches codegen
- `examples/ssr/` — end-to-end demo

## Alternatives considered

- **Stick with ADR 0001 (no SSR for 1.0).** Rejected once exploration
  showed an MVP fits in a week of focused work, not the months 0001
  estimated. The bundle-size and complexity worries were addressed by
  the separate-package design.
- **Full preserve-DOM hydration in the MVP.** Rejected on cost: walking
  the marker stream and reconciling against the client compiled
  templates' positional-path system is genuinely the hardest piece of
  work here. Lossy hydration captures most of the SSR benefit
  (fast first paint) at a fraction of the implementation cost. The
  marker-emission infrastructure is in place so the follow-up ADR can
  pick this up without changing SSR output.
- **A `@purityjs/core/ssr` subpath instead of a separate package.**
  Rejected because the static-prefix optimization in core's Vite lib
  build was already pulling SSR helpers into a separate chunk; a
  separate package makes the boundary explicit and tree-shakes
  cleanly without depending on user bundlers honoring `sideEffects`.
- **Compile-time component registration discovery (no runtime hook).**
  Rejected because it requires the Vite plugin to walk user source
  for `component()` calls — significantly more work than the runtime
  registry that already exists. The runtime hook (`setSSRComponentRenderer`)
  has zero impact on client builds.
