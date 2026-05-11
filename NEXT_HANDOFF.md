# Next handoff

This branch (`claude/next-handoff-item-ect1Q`) ran a long `/loop next`
pass starting from the SSR-MVP follow-up gap list. **Thirty-five
commits, twenty-five new ADRs (0007–0031), 961 tests passing** across
the three publishable packages. Latest iteration shipped ADR 0031 —
`RouteParams<P>`: a template-literal type that derives a typed param
shape from a `matchRoute()` pattern string. Closes the typed-params
half of ADR 0019's deferred "typed route params" non-feature.

Type-only export from `@purityjs/vite-plugin`; zero runtime cost.
Route modules annotate their first arg via
`params: RouteParams<'/users/:id'>` and get `{ id: string }` instead
of the generic `Record<string, string>`. The example's
`pages/users/[id].ts` migrated to demonstrate.

## Test count by package (current)

```
core         629 passing  (31 files)
ssr          145 passing  (11 files)
vite-plugin  187 passing  (10 files)
total        961
```

## ADRs accepted on this branch

Each links to its own decision record with rationale + non-features +
rejected alternatives.

| ADR  | Title                                                                                                       | One-line summary                                                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0005 | [Marker-walking, non-lossy hydration](docs/decisions/0005-non-lossy-hydration.md)                           | `hydrate()` walks SSR markers and binds in place. Per-row `each()` + per-case `when()`/`match()` adoption added in the same era.                     |
| 0006 | [Streaming SSR with Suspense](docs/decisions/0006-streaming-suspense.md)                                    | `suspense(view, fallback)` + `renderToStream` + `__purity_swap`. All six phases shipped — promoted to Accepted in this iteration.                    |
| 0007 | [Text-content rewrite on mismatch](docs/decisions/0007-text-rewrite-on-mismatch.md)                         | Opt-in `enableHydrationTextRewrite()` self-heals SSR text drift in place.                                                                            |
| 0008 | [Head / meta tag management](docs/decisions/0008-head-meta-management.md)                                   | `head()` + `renderToString({ extractHead: true })` for per-route `<title>` / `<meta>`.                                                               |
| 0009 | [Request context](docs/decisions/0009-request-context.md)                                                   | `getRequest()` reads the SSR request; `request?: Request` option on both renderers.                                                                  |
| 0010 | [Static site generation](docs/decisions/0010-static-site-generation.md)                                     | `renderStatic({ routes, handler, shellTemplate })` returns `Map<path, html>` + per-route errors. Runtime-agnostic.                                   |
| 0011 | [Router primitives](docs/decisions/0011-router-primitives.md)                                               | `currentPath()` (reactive, SSR-parity), `navigate(href)`, `matchRoute(pattern)` with `:param` + `*` splat.                                           |
| 0012 | [Server actions](docs/decisions/0012-server-actions.md)                                                     | `serverAction(url, handler)` + `handleAction(request)` + `action.invoke(body, init?)`. PRG-friendly, pure Web Platform.                              |
| 0013 | [Link auto-interception](docs/decisions/0013-link-interception.md)                                          | `interceptLinks()` global click listener with conservative-default predicate. Drops per-link `@click` boilerplate.                                   |
| 0014 | [URL search/hash signals](docs/decisions/0014-url-search-hash-signals.md)                                   | `currentSearch()` + `currentHash()` reactive accessors backed by the same URL signal as `currentPath`.                                               |
| 0015 | [Navigation scroll management](docs/decisions/0015-nav-scroll-management.md)                                | `onNavigate(listener)` hook + `manageNavScroll()` consumer. Closes SPA scroll-restoration gap on forward nav.                                        |
| 0016 | [Navigation focus management](docs/decisions/0016-nav-focus-management.md)                                  | `manageNavFocus()` moves focus into the new page's landmark. Closes the SPA accessibility gap.                                                       |
| 0017 | [View Transitions API integration](docs/decisions/0017-view-transitions.md)                                 | `manageNavTransitions()` wraps navigate() in `document.startViewTransition()`. Reduced-motion aware.                                                 |
| 0018 | [Server-only module strip](docs/decisions/0018-server-module-strip.md)                                      | `*.server.{ts,js,tsx,jsx}` files replaced with `export {};` in client builds. Default-on Vite plugin option.                                         |
| 0019 | [File-system routing — manifest generation](docs/decisions/0019-file-system-routing.md)                     | Opt-in `purity({ routes: { dir } })` exposes virtual `purity:routes` module. `[id]` / `[...slug]` / `index` / `_*` conventions.                      |
| 0020 | [File-system layouts — `_layout` per directory](docs/decisions/0020-layouts.md)                             | Each `RouteEntry` carries a `layouts: LayoutEntry[]` chain (root → leaf). Composer is user-land `reduceRight` for now.                               |
| 0021 | [Error boundaries + 404 — `_error` per directory, root `_404`](docs/decisions/0021-error-boundaries-404.md) | Per-route `errorBoundary?: LayoutEntry` (nearest-wins, no chain) + manifest top-level `notFound?: LayoutEntry`.                                      |
| 0022 | [Data loaders — `loader` named export per route + layout](docs/decisions/0022-data-loaders.md)              | `hasLoader?: true` flag on routes + layouts via regex source detection. Loader signature documented; data plumbing user-land.                        |
| 0023 | [Isomorphic conditional primitives](docs/decisions/0023-isomorphic-control-flow.md)                         | `when()`/`match()`/`each()` auto-detect the SSR render context and dispatch to the `*SSR` variants. Existing names keep working.                     |
| 0024 | [SSR-aware `lazyResource.fetch()`](docs/decisions/0024-ssr-aware-lazy-resource.md)                          | `.fetch()` in an SSR context with a `key` option fires synchronously, registers the promise with `pendingPromises`, blocks the multipass renderer.   |
| 0025 | [`asyncRoute` runtime composer](docs/decisions/0025-async-route-composer.md)                                | `asyncRoute(entry, params)` + `asyncNotFound(notFound)` collapse the manifest-driven composer into one helper call per match.                        |
| 0026 | [`loaderData()` context accessor](docs/decisions/0026-loader-data-accessor.md)                              | Component reads its own loader-data slot via `loaderData<T>()` (no positional arg). Stack-based; pushed/popped by `asyncRoute` per component.        |
| 0027 | [`configureNavigation()` consolidator](docs/decisions/0027-configure-navigation.md)                         | Single `configureNavigation(options?)` enables interceptLinks + manageNavScroll + manageNavFocus + manageNavTransitions. Per-helper opt-out/options. |
| 0028 | [Per-directory `_404.ts` — nested not-found chain](docs/decisions/0028-nested-404-chain.md)                 | Manifest emits `notFoundChain: LayoutEntry[]` (deepest-first); `asyncNotFound(chain)` walks by URL prefix and picks the nearest entry.               |
| 0029 | [`prefetchManifestLinks()` — hover-prefetch route modules](docs/decisions/0029-hover-prefetch.md)           | Delegated `mouseover`/`focusin` listener warms the bundler chunk cache on link hover. Composes with `configureNavigation({ prefetch: { routes } })`. |
| 0030 | [`manageTitle(fn)` — reactive `<title>` sync](docs/decisions/0030-reactive-title.md)                        | Isomorphic helper: emits `<title>` to the SSR head on the server; watches `fn` and writes `document.title` on the client.                            |
| 0031 | [`RouteParams<P>` — typed route params](docs/decisions/0031-typed-route-params.md)                          | Template-literal type derives `{ id: string }` from `'/users/:id'`. Type-only export from `@purityjs/vite-plugin`; zero runtime cost.                |

All ADRs on this branch are `Status: Accepted` (ADR 0006 was promoted
from `Proposed` in this iteration's housekeeping pass).

## Public API map (post-branch)

`@purityjs/core` exports beyond the original 21:

- **Hydration**: `disableHydrationTextRewrite`, `enableHydrationTextRewrite` (ADR 0007).
- **Streaming SSR**: `__purity_swap`, `PURITY_SWAP_SOURCE` (ADR 0006).
- **Head**: `head` (ADR 0008), `manageTitle` (ADR 0030).
- **Request**: `getRequest` (ADR 0009).
- **Router**: `currentHash`, `currentPath`, `currentSearch`, `matchRoute`, `navigate`, `onNavigate`, plus the `NavigateListener` / `NavigateOptions` / `RouteMatch` types (ADRs 0011 + 0014 + 0015).
- **Router opt-ins**: `interceptLinks`, `manageNavFocus`, `manageNavScroll`, `manageNavTransitions`, `configureNavigation`, `prefetchManifestLinks`, plus `*Options` types (ADRs 0013 + 0015 + 0016 + 0017 + 0027 + 0029).
- **Server actions**: `serverAction`, `findAction`, `handleAction`, plus `ServerAction` / `ServerActionHandler` types (ADR 0012).
- **Async-route composer**: `asyncRoute`, `asyncNotFound`, plus `AsyncRouteEntry` / `AsyncNotFoundEntry` / `AsyncRouteOptions` / `LoaderContext` types (ADR 0025).
- **Loader data**: `loaderData<T>()` accessor (ADR 0026).

`@purityjs/ssr` exports:

- `html` (SSR-side template tag).
- `renderToString` (overloaded — returns `string` or `{ body, head }` with `extractHead: true`).
- `renderToStream` (returns `ReadableStream<Uint8Array>`).
- `renderStatic` (returns `Promise<{ files, errors }>`).
- Option/return types: `RenderToStringOptions`, `RenderToStringWithHead`, `RenderToStreamOptions`, `RenderStaticOptions`, `RenderStaticResult`, `RenderStaticRoute`, `SSRHtml`.

`@purityjs/vite-plugin` options:

- `purity({ include?, stripServerModules?, routes? })`. `stripServerModules` defaults `true` (ADR 0018). `routes` defaults `false`; pass `true` for `pages/` or `{ dir, extensions?, virtualId? }` (ADR 0019). `_layout.{ts,tsx,js,jsx}` files attach to each route's `layouts` chain (ADR 0020). `_error.{ts,tsx,js,jsx}` per directory attach a single nearest `errorBoundary` per route, and a root `_404.{ts,tsx,js,jsx}` becomes the manifest's top-level `notFound` (ADR 0021). Routes + layouts that export a named `loader` get `hasLoader: true` in the manifest (ADR 0022). Every `_404` in the tree contributes to `notFoundChain` (ADR 0028). Re-exports `RouteEntry` + `LayoutEntry` for consumers of the virtual module, plus the type-only `RouteParams<P>` for typed route params (ADR 0031).

The SSR README ([packages/ssr/README.md](packages/ssr/README.md))
has the full API tour with copy-pasteable examples for every entry.

## Files most worth re-reading before the next session

- `packages/core/src/router.ts` — URL signal, `navigate()`, `onNavigate()`, internal `_setNavigateWrapper`.
- `packages/core/src/server-action.ts` — registry + `handleAction` + `action.invoke`.
- `packages/ssr/src/render-to-stream.ts` — streaming pipeline incl. per-boundary resource emit.
- `packages/ssr/src/render-static.ts` — SSG driver, composable on top of `renderToString`.
- `packages/vite-plugin/src/index.ts` — `*.server.ts` strip + AOT html-template compile + routes plugin glue.
- `packages/vite-plugin/src/routes.ts` — pure helpers: filename → pattern, sort, layout chain + error boundary + 404 discovery, loader detection, manifest codegen (ADRs 0019 + 0020 + 0021 + 0022).
- `examples/ssr/src/{app,entry.client,entry.server}.ts` — every primitive in one app.
- `examples/ssr-stream-{cf-workers,vercel-edge,deno}/` — minimal edge-runtime templates.
- `examples/ssr/src/pages/` — worked file-system-routing example: `index.ts` (with `loader`), `about.ts`, `users/[id].ts`, `_layout.ts`, `_404.ts`, `_error.ts`. The composer in `examples/ssr/src/app.ts` is now **30 lines** — one `asyncRoute(entry, m.params)` call per match, falling through to `asyncNotFound(notFound!)`. End-to-end exercise of ADRs 0019-0025.
- `packages/core/src/async-route.ts` — `asyncRoute` / `asyncNotFound` runtime composer (ADR 0025). Wraps the manifest-driven view-assembly pipeline; pushes/pops loader data per component (ADR 0026).
- `packages/core/src/loader-data.ts` — `loaderData()` per-component slot stack (ADR 0026). Internal `pushLoaderData` / `popLoaderData` drive the stack from `async-route.ts`.

## Migration findings — closed by this branch

The original `examples/ssr/` manifest migration surfaced two gaps; both
are now closed by ADRs 0023 + 0024.

1. **(closed by ADR 0023)** `when()` / `match()` / `each()` were
   client-only — they called `document.createComment` and crashed
   inside an SSR render path. The unsuffixed names now auto-detect
   the SSR render context and dispatch to the explicit `*SSR`
   variants. The explicit names stay for code that wants a guaranteed
   `SSRHtml` return without the union.
2. **(closed by ADR 0024)** `lazyResource().fetch()` didn't register
   with the SSR multipass context, so a composer pattern like
   `lazyResource(loadStack, { key }).fetch();` shipped the fallback
   because no pending promise blocked the renderer. The new dispatch:
   `.fetch()` inside an SSR context with a `key` option fires the
   fetcher synchronously, pushes the promise onto `pendingPromises`,
   and caches the resolved value in `resolvedDataByKey` so pass 2
   surfaces it through the underlying `resource()`'s SSR path.

Concrete result: `examples/ssr/src/app.ts` is now 128 lines, uses
exclusively the manifest's lazy `importFn()`, calls every route +
layout `loader` in parallel, and threads the resolved data into the
component as a positional arg. The dev/prod server smoke-tests pass —
`/` shows the home page with loader-fetched todos wrapped in the
root layout chrome; `/about`, `/users/42`, `/missing` all render
correctly.

## Side-fix shipped this iteration

The `@purityjs/vite-plugin` build (`vite.config.ts`) used to leave
`node:fs` / `node:path` un-externalized, so the bundled output
inlined a stub module and `dist/index.js` crashed at load with
`(0, r.resolve) is not a function` whenever a downstream config
imported the built plugin. Added `/^node:/` to the `external` list
alongside `/^@purityjs\//`. Affects the publishable plugin —
catches one of the issues a `npm pack` smoke test would have
flagged in CI.

## What's still open

### File-system routing — Phase 5+ (multi-iteration)

ADRs 0019 + 0020 + 0021 + 0022 ship the manifest, layouts, error
boundaries, root 404, and loader detection. Apps now have every
convention piece needed for a real multi-page server-rendered app
on top of the file-system manifest. Remaining items, each
deserving its own ADR:

- **Runtime `loaderData()` context primitive** (ADR 0022 deferred
  non-feature). Phase 1 leaves loader-data plumbing user-land —
  the consumer composer passes data as a positional arg. A
  `loaderData()` accessor in `@purityjs/core` would unify the
  component-signature shape across apps. Wait until enough apps
  converge on the right shape before shipping.
- **Async-component primitive** (`asyncRoute(entry)` or similar).
  ADRs 0020-0022's examples have users hand-rolling
  `lazyResource(() => loadStack(entry))` + `when()` on its data
  state. A small built-in collapses the boilerplate. Probably
  easier to design alongside `loaderData()`.
- **Per-directory `_404.ts`** (ADR 0021 deferred non-feature).
  Adding nested 404s needs a `notFoundChain` field on the
  manifest (or an in-tree walk at runtime). Useful once apps
  ship section-styled 404 pages.
- **Loader on error boundaries / 404** (ADR 0022 deferred
  non-feature). Currently only routes + layouts get loader
  detection. A 404 page wanting server-side data has to fall back
  to client-side fetch.
- **Build-time route table emit**. The manifest is virtual today.
  Emitting to disk (e.g. `src/.purity/routes.ts`) gives `tsc` and
  IDEs something to inspect — useful for typed route params (a
  follow-on after this).
- **Typed route params + typed loader data**. Template-literal-
  derived `RouteParams<'/users/:id'>` plus the loader return type
  threaded through the manifest type. Cheap once the manifest is
  real-on-disk; both pin themselves to the consumer's component
  signature.
- **Loader-data revalidation**. Per-resource invalidate (Remix
  `revalidate()`, Next `revalidatePath()`) needs a cache +
  invalidation primitive. Out of Phase 1; documented as a
  non-feature in ADR 0022.
- **Worked example**. `examples/ssr/` still uses the
  `if (matchRoute(…))` ladder from before ADRs 0019-0022 shipped.
  A 30-60-minute migration to the manifest + layout + boundary
  - loader loop would prove the four-ADR conventions end-to-end
    and double as docs.

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

ADR 0031 shipped the typed-params half of Path J this iteration.
The on-disk emit half is the natural follow-up; two items remain
on the high-leverage list plus one Path K leftover.

**Path J' — on-disk manifest emit (next ADR).** ADR 0031 ships
the type utility; the matching build-time emit would let `tsc`
infer typed entries via iteration. Adds an `emitTo?: string`
option to the plugin; on `load()` of the virtual module, also
writes the generated source to disk. Apps that want auto-typed
entries set the option + import from the file path instead of
`purity:routes`. ~half a day.

**Path H — streaming-SSR adapter migration to the manifest.**
ADR 0006's adapter examples (`ssr-stream-cf-workers/`,
`ssr-stream-vercel-edge/`, `ssr-stream-deno/`) predate the
manifest + `asyncRoute()`. Migrate one (start with `cf-workers`)
to use the manifest + `asyncRoute()` pattern and verify the
streaming pipeline works end-to-end with the lazyResource
registration. Likely surfaces a missing pendingPromises-for-stream
hook in `renderToStream`; that's the actionable signal.

**Path K (remainder) — one item left.**

- Smart `serverAction()` body-only stripping (ADR 0018) — strip
  handler bodies without renaming files to `*.server.ts`. Needs
  an AST parser pass to find `serverAction(url, fn)` calls and
  replace the handler arg with a stub in client builds. ~half a
  day; depends on adding a minimal JS parser dep or carving out
  esbuild's parse pass.

Path J' is the natural sequel to this iteration. Path H validates
the streaming pipeline. Path K's last item is parser-shaped —
bigger than the items shipped so far.
