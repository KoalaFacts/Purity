# Next handoff

This branch (`claude/next-handoff-item-ect1Q`) ran a long `/loop next`
pass starting from the SSR-MVP follow-up gap list. **Twenty-six
commits, sixteen new ADRs (0007–0022), 886 tests passing** across the
three publishable packages. Latest iteration migrated `examples/ssr/`
to consume the file-system-routing manifest end-to-end — every route,
the root layout, the root 404, and the root error boundary now live
under `examples/ssr/src/pages/`. Surfaced two real ergonomics gaps
along the way (see "Migration findings" below); both motivate the
runtime ADR (0023).

## Test count by package (current)

```
core         565 passing  (26 files)
ssr          145 passing  (11 files)
vite-plugin  176 passing  ( 9 files)
total        886
```

## ADRs accepted on this branch

Each links to its own decision record with rationale + non-features +
rejected alternatives.

| ADR  | Title                                                                                                       | One-line summary                                                                                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 0005 | [Marker-walking, non-lossy hydration](docs/decisions/0005-non-lossy-hydration.md)                           | `hydrate()` walks SSR markers and binds in place. Per-row `each()` + per-case `when()`/`match()` adoption added in the same era. |
| 0006 | [Streaming SSR with Suspense](docs/decisions/0006-streaming-suspense.md)                                    | `suspense(view, fallback)` + `renderToStream` + `__purity_swap`. All six phases shipped — selective hydration is out of scope.   |
| 0007 | [Text-content rewrite on mismatch](docs/decisions/0007-text-rewrite-on-mismatch.md)                         | Opt-in `enableHydrationTextRewrite()` self-heals SSR text drift in place.                                                        |
| 0008 | [Head / meta tag management](docs/decisions/0008-head-meta-management.md)                                   | `head()` + `renderToString({ extractHead: true })` for per-route `<title>` / `<meta>`.                                           |
| 0009 | [Request context](docs/decisions/0009-request-context.md)                                                   | `getRequest()` reads the SSR request; `request?: Request` option on both renderers.                                              |
| 0010 | [Static site generation](docs/decisions/0010-static-site-generation.md)                                     | `renderStatic({ routes, handler, shellTemplate })` returns `Map<path, html>` + per-route errors. Runtime-agnostic.               |
| 0011 | [Router primitives](docs/decisions/0011-router-primitives.md)                                               | `currentPath()` (reactive, SSR-parity), `navigate(href)`, `matchRoute(pattern)` with `:param` + `*` splat.                       |
| 0012 | [Server actions](docs/decisions/0012-server-actions.md)                                                     | `serverAction(url, handler)` + `handleAction(request)` + `action.invoke(body, init?)`. PRG-friendly, pure Web Platform.          |
| 0013 | [Link auto-interception](docs/decisions/0013-link-interception.md)                                          | `interceptLinks()` global click listener with conservative-default predicate. Drops per-link `@click` boilerplate.               |
| 0014 | [URL search/hash signals](docs/decisions/0014-url-search-hash-signals.md)                                   | `currentSearch()` + `currentHash()` reactive accessors backed by the same URL signal as `currentPath`.                           |
| 0015 | [Navigation scroll management](docs/decisions/0015-nav-scroll-management.md)                                | `onNavigate(listener)` hook + `manageNavScroll()` consumer. Closes SPA scroll-restoration gap on forward nav.                    |
| 0016 | [Navigation focus management](docs/decisions/0016-nav-focus-management.md)                                  | `manageNavFocus()` moves focus into the new page's landmark. Closes the SPA accessibility gap.                                   |
| 0017 | [View Transitions API integration](docs/decisions/0017-view-transitions.md)                                 | `manageNavTransitions()` wraps navigate() in `document.startViewTransition()`. Reduced-motion aware.                             |
| 0018 | [Server-only module strip](docs/decisions/0018-server-module-strip.md)                                      | `*.server.{ts,js,tsx,jsx}` files replaced with `export {};` in client builds. Default-on Vite plugin option.                     |
| 0019 | [File-system routing — manifest generation](docs/decisions/0019-file-system-routing.md)                     | Opt-in `purity({ routes: { dir } })` exposes virtual `purity:routes` module. `[id]` / `[...slug]` / `index` / `_*` conventions.  |
| 0020 | [File-system layouts — `_layout` per directory](docs/decisions/0020-layouts.md)                             | Each `RouteEntry` carries a `layouts: LayoutEntry[]` chain (root → leaf). Composer is user-land `reduceRight` for now.           |
| 0021 | [Error boundaries + 404 — `_error` per directory, root `_404`](docs/decisions/0021-error-boundaries-404.md) | Per-route `errorBoundary?: LayoutEntry` (nearest-wins, no chain) + manifest top-level `notFound?: LayoutEntry`.                  |
| 0022 | [Data loaders — `loader` named export per route + layout](docs/decisions/0022-data-loaders.md)              | `hasLoader?: true` flag on routes + layouts via regex source detection. Loader signature documented; data plumbing user-land.    |

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

- `purity({ include?, stripServerModules?, routes? })`. `stripServerModules` defaults `true` (ADR 0018). `routes` defaults `false`; pass `true` for `pages/` or `{ dir, extensions?, virtualId? }` (ADR 0019). `_layout.{ts,tsx,js,jsx}` files attach to each route's `layouts` chain (ADR 0020). `_error.{ts,tsx,js,jsx}` per directory attach a single nearest `errorBoundary` per route, and a root `_404.{ts,tsx,js,jsx}` becomes the manifest's top-level `notFound` (ADR 0021). Routes + layouts that export a named `loader` get `hasLoader: true` in the manifest (ADR 0022). Re-exports `RouteEntry` + `LayoutEntry` for consumers of the virtual module.

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
- `examples/ssr/src/pages/` — worked file-system-routing example: `index.ts` (with `loader`), `about.ts`, `users/[id].ts`, `_layout.ts`, `_404.ts`, `_error.ts`. The composer in `examples/ssr/src/app.ts` uses the manifest for dispatch + layout chain + error-boundary identification but currently relies on static page-module imports — the gap that motivates the runtime ADR.

## Migration findings (Path A — what hurt)

The `examples/ssr/` migration to the manifest exposed two gaps the
composer-pattern docs in ADRs 0020-0022 hand-wave past. Both are the
concrete scope of the runtime ADR (0023):

1. **`when()` / `match()` are client-only.** Both call
   `document.createComment` to lay marker nodes, so calling them
   inside an SSR render path throws `ReferenceError: document is not
defined`. The framework ships explicit SSR variants
   (`whenSSR` / `matchSSR` / `eachSSR`) that the user must pick
   per call site. Users writing a manifest-driven composer will
   reach for `when(stack.data(), …)` first and get a confusing
   server crash; isomorphic versions (auto-detect SSR context) would
   close this hole.
2. **`lazyResource()` doesn't register with the SSR multipass
   context.** Apps using `lazyResource(() => loadStack(entry, params))
.fetch(); when(() => stack.data(), …)` see SSR ship the suspense
   fallback because the resource never registers a pending promise the
   renderer awaits between passes. `resource()` (the auto-fetching
   variant) does register, but doesn't fit the "fetch on demand
   per-route" shape. The runtime composer needs a primitive that
   blocks SSR until the imports + loader resolve.

Concrete consequence: `examples/ssr/src/app.ts` falls back to
**static imports of every page module** at the top of the file. The
manifest is still consulted for pattern matching + layout-chain
walking + error-boundary identification + `hasLoader` reporting — so
ADRs 0019-0022 are exercised — but the per-route lazy `importFn()` is
shadowed by static imports. Code splitting still happens for the
client bundle (Vite warns about the ineffective dynamic imports but
doesn't drop them), so the trade-off is local to the demo.

The home page (`pages/index.ts`) ships a `loader` named export that
the manifest correctly flags with `hasLoader: true` — verifiable in
the built `entry.server.js`. The page itself uses the existing
`resource()` + `suspense()` pattern for its data because the user-
land composer cannot yet invoke the loader and thread the result
into the component without re-introducing the `when()` / async
gaps above.

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

Path A landed this iteration. The natural follow-up is **Path B —
ADR 0023: runtime composition primitives**, informed by the two
gaps the migration surfaced. Outline:

1. **Isomorphic `when` / `match`** (or document the SSR variants
   harder). Either auto-detect the SSR context inside `when()` and
   route to `whenSSR` internally, or rename `whenSSR` to make it
   harder to reach for the wrong one. The SSR-vs-client split is a
   foot-gun the manifest-consumer pattern walks straight into.
2. **`asyncRoute(entry, params)` runtime helper**. Wraps the
   route + layout-chain + error-boundary + loader-await pipeline
   into one function the consumer's loop calls per match. Probably
   needs an SSR-aware async primitive (a `lazyResource` variant
   that registers with the multipass context, or extending
   `resource()` to accept lazy fetchers).
3. **`loaderData()` accessor** for routes / layouts to read their
   own loader's resolved value without positional-arg threading.
   Per-render slot keyed by the route entry.
4. Draft ADR 0023 with the convention + rejected alternatives,
   migrate `examples/ssr/src/app.ts` to use the new helpers
   (drops the static-import workaround documented in "Migration
   findings"), update tests, update handoff.

If the time budget is tight: **promote ADR 0006 to Accepted**
(one-line status change) or **pick a deferred follow-up from the
smaller-items list below**.
