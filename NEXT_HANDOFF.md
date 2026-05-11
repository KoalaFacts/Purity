# Next handoff

This branch (`claude/next-handoff-item-ect1Q`) ran a long `/loop next`
pass starting from the SSR-MVP follow-up gap list. **Twenty commits,
twelve new ADRs (0007–0018), 804 tests passing** across the three
publishable packages. Everything is documented and shipped — only one
substantive item remains open. This note captures the current state
so the next session can pick up cold.

## Test count by package (current)

```
core         565 passing  (26 files)
ssr          145 passing  (11 files)
vite-plugin   94 passing  ( 8 files)
total        804
```

## ADRs accepted on this branch

Each links to its own decision record with rationale + non-features +
rejected alternatives.

| ADR  | Title                                                                               | One-line summary                                                                                                                 |
| ---- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 0005 | [Marker-walking, non-lossy hydration](docs/decisions/0005-non-lossy-hydration.md)   | `hydrate()` walks SSR markers and binds in place. Per-row `each()` + per-case `when()`/`match()` adoption added in the same era. |
| 0006 | [Streaming SSR with Suspense](docs/decisions/0006-streaming-suspense.md)            | `suspense(view, fallback)` + `renderToStream` + `__purity_swap`. All six phases shipped — selective hydration is out of scope.   |
| 0007 | [Text-content rewrite on mismatch](docs/decisions/0007-text-rewrite-on-mismatch.md) | Opt-in `enableHydrationTextRewrite()` self-heals SSR text drift in place.                                                        |
| 0008 | [Head / meta tag management](docs/decisions/0008-head-meta-management.md)           | `head()` + `renderToString({ extractHead: true })` for per-route `<title>` / `<meta>`.                                           |
| 0009 | [Request context](docs/decisions/0009-request-context.md)                           | `getRequest()` reads the SSR request; `request?: Request` option on both renderers.                                              |
| 0010 | [Static site generation](docs/decisions/0010-static-site-generation.md)             | `renderStatic({ routes, handler, shellTemplate })` returns `Map<path, html>` + per-route errors. Runtime-agnostic.               |
| 0011 | [Router primitives](docs/decisions/0011-router-primitives.md)                       | `currentPath()` (reactive, SSR-parity), `navigate(href)`, `matchRoute(pattern)` with `:param` + `*` splat.                       |
| 0012 | [Server actions](docs/decisions/0012-server-actions.md)                             | `serverAction(url, handler)` + `handleAction(request)` + `action.invoke(body, init?)`. PRG-friendly, pure Web Platform.          |
| 0013 | [Link auto-interception](docs/decisions/0013-link-interception.md)                  | `interceptLinks()` global click listener with conservative-default predicate. Drops per-link `@click` boilerplate.               |
| 0014 | [URL search/hash signals](docs/decisions/0014-url-search-hash-signals.md)           | `currentSearch()` + `currentHash()` reactive accessors backed by the same URL signal as `currentPath`.                           |
| 0015 | [Navigation scroll management](docs/decisions/0015-nav-scroll-management.md)        | `onNavigate(listener)` hook + `manageNavScroll()` consumer. Closes SPA scroll-restoration gap on forward nav.                    |
| 0016 | [Navigation focus management](docs/decisions/0016-nav-focus-management.md)          | `manageNavFocus()` moves focus into the new page's landmark. Closes the SPA accessibility gap.                                   |
| 0017 | [View Transitions API integration](docs/decisions/0017-view-transitions.md)         | `manageNavTransitions()` wraps navigate() in `document.startViewTransition()`. Reduced-motion aware.                             |
| 0018 | [Server-only module strip](docs/decisions/0018-server-module-strip.md)              | `*.server.{ts,js,tsx,jsx}` files replaced with `export {};` in client builds. Default-on Vite plugin option.                     |

ADR 0006 is `Status: Proposed` historically but every named phase is
now shipped — promote to `Accepted` next time anyone touches it.

## Public API map (post-branch)

`@purityjs/core` exports beyond the original 21:

- **Hydration**: `disableHydrationTextRewrite`, `enableHydrationTextRewrite` (ADR 0007).
- **Streaming SSR**: `__purity_swap`, `PURITY_SWAP_SOURCE` (ADR 0006).
- **Head**: `head` (ADR 0008).
- **Request**: `getRequest` (ADR 0009).
- **Router**: `currentHash`, `currentPath`, `currentSearch`, `matchRoute`, `navigate`, `onNavigate`, plus the `NavigateListener` / `NavigateOptions` / `RouteMatch` types (ADRs 0011 + 0014 + 0015).
- **Router opt-ins**: `interceptLinks`, `manageNavFocus`, `manageNavScroll`, `manageNavTransitions`, plus `*Options` types (ADRs 0013 + 0015 + 0016 + 0017).
- **Server actions**: `serverAction`, `findAction`, `handleAction`, plus `ServerAction` / `ServerActionHandler` types (ADR 0012).

`@purityjs/ssr` exports:

- `html` (SSR-side template tag).
- `renderToString` (overloaded — returns `string` or `{ body, head }` with `extractHead: true`).
- `renderToStream` (returns `ReadableStream<Uint8Array>`).
- `renderStatic` (returns `Promise<{ files, errors }>`).
- Option/return types: `RenderToStringOptions`, `RenderToStringWithHead`, `RenderToStreamOptions`, `RenderStaticOptions`, `RenderStaticResult`, `RenderStaticRoute`, `SSRHtml`.

`@purityjs/vite-plugin` options:

- `purity({ include?, stripServerModules? })`. `stripServerModules` defaults `true` (ADR 0018).

The SSR README ([packages/ssr/README.md](packages/ssr/README.md))
has the full API tour with copy-pasteable examples for every entry.

## Files most worth re-reading before the next session

- `packages/core/src/router.ts` — URL signal, `navigate()`, `onNavigate()`, internal `_setNavigateWrapper`.
- `packages/core/src/server-action.ts` — registry + `handleAction` + `action.invoke`.
- `packages/ssr/src/render-to-stream.ts` — streaming pipeline incl. per-boundary resource emit.
- `packages/ssr/src/render-static.ts` — SSG driver, composable on top of `renderToString`.
- `packages/vite-plugin/src/index.ts` — `*.server.ts` strip + AOT html-template compile.
- `examples/ssr/src/{app,entry.client,entry.server}.ts` — every primitive in one app.
- `examples/ssr-stream-{cf-workers,vercel-edge,deno}/` — minimal edge-runtime templates.

## What's still open

### File-system routing + nested layouts (substantial — multi-iteration)

The biggest remaining framework gap. Builds on top of ADR 0011's
router primitives (`currentPath` / `matchRoute` / `navigate`) and
ADR 0018's server-module strip. Needs:

- **Vite plugin pass** that scans a `pages/` (or `routes/`)
  directory at dev/build time, generates a route table mapping URL
  patterns to lazy module imports.
- **Layout nesting**: a `_layout.ts` per directory that wraps
  child route output. Standard pattern (Remix / SvelteKit / Astro).
- **Per-route data loaders**: a route module's `loader()` runs on
  the server before the view renders. Co-located with the route.
- **Route-level error boundaries** + 404 conventions.
- **HMR for the route table** — adding / removing files updates the
  match dispatcher without a server restart.

Where to start: a focused ADR sketching the file convention and the
minimum viable plugin pass. Match the existing `/loop next` pattern
of "ship the smallest correct thing, defer the smart additions to
follow-up ADRs." Likely 3–5 iterations to get to a usable MVP.

### ISR / PPR (incremental static regen / partial pre-render)

Higher-level patterns that compose on top of `renderStatic` (ADR
0010). Not yet designed — separate ADR when there's demand.

### Selective per-boundary hydration timing

Out of scope per ADR 0006. Currently hydration waits until the
stream closes. React-style per-boundary hydration triggered by
user interaction needs event replay; a strictly larger problem.

### Smaller deferred follow-ups (each its own ADR slot)

- **Smart `serverAction()` body-only stripping** (ADR 0018
  non-feature) — preserves `.url` + `.invoke()` on the client side
  while stripping the handler body.
- **`<title>` synchronisation helper** (ADR 0016 non-feature) —
  reactive title-tag management beyond `head()`'s static capture.
- **ARIA live region announce primitive** (ADR 0016 non-feature) —
  alternative to focus-move for routes that prefer announce-only.
- **Scroll-position persistence across reload** (ADR 0015
  non-feature).
- **Async-aware view transitions** (ADR 0017 non-feature) —
  return-Promise from the wrapper callback to await route data.
- **`configureNavigation({ scroll, focus, transitions, … })`
  consolidation** (ADR 0017 non-feature) — single setup helper for
  the four `manageNav*` opt-ins.
- **Reactive head element management for client routes** (ADR 0008
  Phase 2) — likely splits into `@purityjs/head` package.
- **Phoenix-LiveView-style scroll persistence** + **focus
  restoration on back-nav** + **prefetch-on-hover** (ADRs 0015 +
  0016 non-features).
- **DSD fallback for pre-2024 browsers** — out of scope per ADR 0004.
- **CSRF helper** (ADR 0012 non-feature).
- **Auto-serialization / RPC sugar over `serverAction`** (ADR 0012
  non-feature).
- **Build-time URL derivation for server actions** (ADR 0012
  non-feature) — Next-style stable opaque IDs.

## Recommended next sprint

If you have a session-or-more of focus to spend: **start the
file-system routing ADR**. Outline:

1. Sketch the `pages/` vs `routes/` directory convention. What's a
   route module? How are layouts nested? How does the dynamic
   `[id].ts` segment map to `:id`?
2. Decide the manifest shape: build-time generated TypeScript
   module exporting an array of `{ pattern, importFn }` that the
   client + server imports. Or runtime via `import.meta.glob`.
3. Draft ADR 0019 with the convention + the rejected alternatives
   (Next App Router file conventions, Remix nested routes,
   SvelteKit `+page.ts`/`+layout.ts`, Astro `pages/`).
4. Implement the smallest viable plugin pass. Tests + worked example
   - handoff entry.

If you have less time: **promote ADR 0006 to Accepted** (one-line
status change — every named phase has shipped) and **pick a
deferred follow-up from the list above** that matches the time
budget.
