# 0025: `asyncRoute` runtime composer — manifest-driven view assembly

**Status:** Accepted
**Date:** 2026-05-11

## Context

ADRs 0019-0024 ship the file-system-routing manifest, layout chains,
error boundaries, root 404, loader detection, and SSR-aware lazy
fetching. The `examples/ssr/` migration proves the pieces compose
correctly — but the user-land composer it wrote
(`examples/ssr/src/app.ts`) is **~60 lines of `loadStack` + 30 lines
of `renderEntry` / `renderNotFound`** that every Purity app
consuming `purity:routes` will re-implement identically:

```ts
async function loadStack(entry, params) {
  const ctx = { request: …, params, signal: … };
  try {
    const [routeMod, ...layoutMods] = await Promise.all([
      entry.importFn(),
      ...entry.layouts.map((l) => l.importFn()),
    ]);
    const [routeData, ...layoutsData] = await Promise.all([
      entry.hasLoader ? routeMod.loader(ctx) : undefined,
      ...entry.layouts.map((l, i) => l.hasLoader ? layoutMods[i].loader(ctx) : undefined),
    ]);
    return () => {
      let view = () => routeMod.default(params, routeData);
      for (let i = layoutMods.length - 1; i >= 0; i--) {
        const layout = layoutMods[i];
        const data = layoutsData[i];
        const inner = view;
        view = () => layout.default(inner, data);
      }
      return view();
    };
  } catch (err) {
    if (entry.errorBoundary) {
      const errMod = await entry.errorBoundary.importFn();
      return () => errMod.default(err);
    }
    throw err;
  }
}

function renderEntry(entry, params) {
  const stack = lazyResource(() => loadStack(entry, params), {
    key: `route:${entry.pattern}`,
  });
  stack.fetch();
  return when(
    () => stack() !== undefined,
    () => stack()(),
    () => html`<p class="loading">…</p>`,
  );
}
```

Every line is mechanical. The pattern is what ADRs 0019-0024
intended — but until it's a single primitive, every app re-derives
it. The migration to the manifest is incomplete in practice.

The shipping ecosystem's equivalent: Remix's `<Outlet>`, Next App
Router's nested `page.tsx` + `layout.tsx` machinery, SvelteKit's
auto-generated `+page.svelte` runtime. They're each a router and a
view composer wrapped together. We've split the router (manifest +
`matchRoute`) from the view composer; this ADR ships the view
composer.

## Decision

**Add `asyncRoute(entry, params, options?)` and
`asyncNotFound(notFound, options?)` to `@purityjs/core`.** Both
return the rendered view (or a fallback during loading). Internally
each:

1. Creates a `lazyResource(() => loadStack(...), { key: '…' })` —
   ADR 0024 gives us SSR multipass for free via the `key` option.
2. Calls `.fetch()` synchronously (server: registers with
   `pendingPromises`; client: reactively triggers).
3. Returns `when(() => r() !== undefined, () => r()(), fallback)` —
   ADR 0023 makes this isomorphic across SSR + client.

The `loadStack` helper inside `asyncRoute` does the layout chain

- loader-await + error-boundary fallback exactly like the
  hand-rolled version in `examples/ssr/src/app.ts`. The layout
  composer threads loader data into the component via the second
  positional arg (route: `(params, data) => view`; layout:
  `(children, data) => view`), matching ADR 0022's documented shape.

```ts
import { asyncNotFound, asyncRoute, html, matchRoute } from '@purityjs/core';
import { notFound, routes } from 'purity:routes';

export function App() {
  for (const entry of routes) {
    const m = matchRoute(entry.pattern);
    if (m) return asyncRoute(entry, m.params);
  }
  return notFound ? asyncNotFound(notFound) : html`<h1>404</h1>`;
}
```

`examples/ssr/src/app.ts` shrinks from 128 lines to ~12 — the
manifest-driven app pattern is now one short loop.

Concretely:

- **`asyncRoute(entry, params, options?)`** — `entry` is shaped
  like `RouteEntry & { importFn, layouts, errorBoundary? }`. Param
  type is structural, not nominal: any object matching the
  manifest's emitted shape works (lets the helper live in core
  without depending on `@purityjs/vite-plugin`).
- **`asyncNotFound(entry, options?)`** — `entry` is shaped like
  `LayoutEntry & { importFn }` (the manifest's `notFound` field).
  Renders the page with no params or layout — same shape as the
  hand-rolled `renderNotFound`.
- **`AsyncRouteOptions`** fields:
  - `fallback?: () => unknown` — view rendered while the loader
    pipeline resolves. Default: empty `html\`\``(no flash). Apps
pass`() => html\`<p>loading…</p>\`` for a visible spinner.
  - `keyPrefix?: string` — prepended to the route's `pattern` for
    the lazyResource key. Default `'route:'` for `asyncRoute`,
    `'notFound:'` for `asyncNotFound`. Override only when a single
    page hosts multiple manifest consumers that would collide.
  - `request?: () => Request` — overrides the default request
    construction. The default uses `getRequest()` (ADR 0009) on
    the server and constructs a `new Request(window.location.href)`
    on the client. Apps with a custom request shape pass an
    override.
- **Loader signature** matches ADR 0022:
  `loader({ request, params, signal }) => data | Promise<data>`.
  The composer constructs the context from the args. The
  `AbortSignal` is from a fresh `AbortController`; on the server
  it never aborts (the renderer awaits to completion); on the
  client a future ADR can wire it to navigation aborts.
- **Component data shape** is positional, matching ADR 0022's
  documented user-land convention:
  - Route: `(params: Record<string, string>, data: unknown) => view`
  - Layout: `(children: () => unknown, data: unknown) => view`
  - Error boundary: `(error: unknown) => view` (ADR 0021)
  - 404: `() => view`
- **Error handling**:
  - Fetcher rejection at any step (route import, layout import,
    loader call) is caught inside `loadStack`.
  - If `entry.errorBoundary` is set, the boundary's default export
    is rendered with the caught error.
  - Otherwise the error re-throws and bubbles to the consumer.
  - In SSR, ADR 0024's pass-2 cached-error re-throw triggers the
    same path on the second pass — apps see the boundary view
    rendered into the SSR HTML.

### Explicit non-features

- **No automatic `App()` wrapper.** Apps still write the
  `for (const entry of routes) {…}` loop. A `routerDispatch(routes,
notFound?)` helper would shrink it further but locks app authors
  out of pre-/post-route hooks (auth gates, logging, A/B routing).
  Keep the loop visible.
- **No client-side route prefetch.** The composer fetches lazily
  on render. Hover-prefetch (Next/SvelteKit pattern) is a future
  ADR — needs a `<link rel="prefetch">` hook into
  `interceptLinks()` (ADR 0013).
- **No per-route caching policy.** `asyncRoute` always re-fetches
  on navigation (the lazyResource is fresh per render). Resource
  revalidation / stale-while-revalidate per the route's loader is
  the next ADR (paired with `loaderData()`).
- **No `loaderData()` accessor.** Loader data threads via the
  positional arg as documented. A future ADR ships `loaderData()`
  for components that prefer reading from a per-render context
  slot — drops in alongside `asyncRoute` without changing it.
- **No streaming (per-route suspense boundaries).** The composer
  awaits the entire loadStack before rendering. Apps that want
  per-section streaming wrap parts of their route view in
  `suspense()` (ADR 0006). The composer doesn't auto-thread
  suspense boundaries around layouts.
- **No support for layout chains under `asyncNotFound`.** Phase 1
  ships `notFound` as a single page rendered without chrome (the
  manifest's top-level `notFound` doesn't carry layouts). Apps that
  want a layout-wrapped 404 either wrap their App's return value or
  wait for nested-404 support (deferred per ADR 0021).
- **No bundled custom-element variant.** A future
  `<purity-route entry=…>` Custom Element could compose with `<head>`
  / suspense in ways the function form can't. Skip — adds surface
  area before the function form has wear marks.
- **No automatic `Request` from `IncomingMessage` shim.** The
  default `request` builder uses the Web Platform `Request`
  constructor and either `getRequest()` (server) or
  `window.location.href` (client). Node `http` users still convert
  in their server entry per ADR 0009.

## Consequences

**Positive:**

- Closes the bigger gap from the migration: the user-land composer
  becomes a one-line call. Apps consuming the manifest stop
  reinventing the same `loadStack` + `renderEntry` machinery.
- Composes cleanly with ADRs 0023 + 0024 — both surfaces designed
  for this composer to call. The composer is ~50 LOC of orchestration
  on top of primitives that already work.
- The example shrinks from 128 lines to ~12. The pattern becomes
  apparent rather than buried in user-land machinery.
- Apps that want a custom composer keep writing one — the helpers
  are pure functions over the manifest entries; nothing
  hard-binds the framework to them.

**Negative:**

- New surface area in `@purityjs/core` (2 functions + an options
  type). Tree-shaken when unused. Pulls some weight in the bundle
  for apps that don't use the manifest.
- The structural type for `entry` accepts any matching shape —
  TypeScript can't catch passing the wrong manifest's entry.
  Acceptable: the manifest's emitted shape is documented in
  ADR 0019 + the plugin's `RouteEntry` interface; mismatched
  consumers fail at the first `importFn()` call.
- Loader data threads positional — a future `loaderData()` helper
  ships under a separate ADR. Apps that adopt `asyncRoute` first
  and `loaderData()` later have to refactor route signatures from
  `(params, data) => view` to `(params) => view + loaderData()`.
  Trade-off documented; both shapes will coexist (the helper just
  passes the data positionally regardless).

**Neutral:**

- Helpers live in `@purityjs/core` rather than a separate
  `@purityjs/router` package. Reasoning: they depend on
  `lazyResource`, `when`, `getRequest` — all in core. Splitting
  them out would require new package + shared types + wiring;
  no benefit until the framework grows multiple router options.
- The composer always fetches on render — no caching layer between
  `lazyResource` and the manifest. Apps that want caching wrap
  the helpers themselves or use `resource()`'s revalidation
  primitives (when they ship — see "non-features").
- Tests cover both helpers in unit form plus an integration test
  via `renderToString` against a stub manifest. The example's
  smoke-test (4 routes via prod server) doubles as integration
  coverage.

## Alternatives considered

**Bundle the dispatch into one `routerDispatch(routes, notFound?,
options?)` helper.** Replaces the consumer's whole `for` loop with
one call. Rejected: locks app authors out of pre-/post-route hooks
(auth gates, A/B routing, logging). The visible `for` loop is
three lines and worth keeping.

**Custom-element form `<purity-route entry=…>`.** Wraps the
function form in a Custom Element. Composes with `<head>` /
suspense in declarative templates. Rejected for Phase 1: function
form is what the existing example already uses; adding the
element form before usage data shows it's worth doubles surface
area without proven payoff.

**Merge `asyncRoute` + `asyncNotFound` into one helper that takes
either entry shape.** Single name, two paths. Rejected: 404 has no
params and no layouts; encoding both contracts in one helper
forces every caller to pass `null` somewhere. Two named helpers
read better.

\*\*Take a `manifest` argument that bundles `routes` + `notFound`

- a fallback.\*\* `asyncRoute(manifest, params)` introspects the
  URL itself. Rejected: hides the matchRoute call. Apps that want
  full control of routing (which they always will eventually) lose
  visibility. Composing the for-loop with the per-entry helper is
  the right granularity.

**Accept `entry` as the user's import path (`'./pages/users/[id].ts'`)
and import internally.** Replaces `importFn` with a string path.
Rejected: defeats the manifest's purpose (the plugin already
generated the lazy `importFn`). Strings would also force the
helper to resolve paths — that's bundler magic that breaks at
runtime.

**Make the loader-context shape configurable.** Pass a
`buildContext(args) => unknown` option that the helper passes to
the loader instead of `{ request, params, signal }`. Rejected:
the documented `LoaderContext` shape is the convention from ADR
0022; deviating per-call defeats the convention. Apps with a
different shape build a thin wrapper around `asyncRoute` or
write their own composer.

**Implement caching in the composer (per-pattern memoization).**
A `Map<pattern, ViewFactory>` so the second navigation to the
same route reuses the resolved factory. Rejected: the composer
holds no persistent state across renders; caching belongs in
`resource()` revalidation. Adding a cache here is premature.
