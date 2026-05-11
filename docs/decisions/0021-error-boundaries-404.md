# 0021: Error boundaries + 404 — `_error` per directory, root `_404`

**Status:** Accepted
**Date:** 2026-05-11

## Context

ADR [0019](./0019-file-system-routing.md) shipped the file-system
route manifest. ADR [0020](./0020-layouts.md) added `_layout.ts`
per directory. The reserved `_` prefix already excludes both from
the route manifest. Two recurring needs remain:

- **Errors thrown inside a route** (failed `resource()`, thrown
  from a `loader()` once those land, raised by `lazyResource`'s
  rejected promise) currently bubble to the top of the consumer's
  loop and produce a blank screen. Apps work around this by
  wrapping every route in their own try/catch — boilerplate that
  belongs in convention.
- **Unmatched paths** are handled by the consumer's `for` loop's
  fall-through (`return html\`<h1>404</h1>\``). Every app writes
  its own 404 markup; sharing it across the app means another
  hand-imported component.

The shipping ecosystem has converged on file-name conventions for
both:

- **Next App Router** — `error.tsx` + `not-found.tsx` per directory.
  Errors bubble to the nearest `error.tsx`; `notFound()` thrown
  from a route renders the nearest `not-found.tsx`.
- **Remix** — `ErrorBoundary` named export from any route module.
  No separate file convention; each route defines its own boundary.
- **SvelteKit** — `+error.svelte` per directory; renders for both
  thrown errors AND 404s (one file, two purposes).

Purity already has the per-directory chain machinery from ADR 0020.
The right Phase-1 convention is two file-name patterns sharing the
same chain mechanism:

- `_error.{ts,tsx,js,jsx}` per directory — handles errors thrown by
  any route in this directory subtree. Same root → leaf chain as
  layouts; the **nearest** boundary handles the error (we don't
  bubble through parents in Phase 1).
- `_404.{ts,tsx,js,jsx}` only at the routes-dir root in Phase 1 —
  rendered by the consumer's "no match" fall-through. Per-directory
  404s require URL-prefix-walk runtime logic; defer.

## Decision

**Extend the route manifest with two additional fields:**

1. **`RouteEntry.errorBoundary?: LayoutEntry`** — set to the
   nearest `_error.{ts,tsx,js,jsx}` in the route's directory
   chain (root included). Omitted from the entry when no `_error`
   exists in any parent directory. Single entry, not a chain.
2. **`notFound?: LayoutEntry`** at the manifest top level — set
   when the routes-dir root contains a `_404.{ts,tsx,js,jsx}`.
   Omitted from the manifest when the root has no `_404`. Phase 1
   supports root only; nested 404s are deferred.

The Vite plugin discovers both file patterns during the same scan
that builds the route + layout manifest. No new plugin option —
both are convention-discovered.

```
src/pages/
├── _layout.ts          → root layout
├── _error.ts           → root error boundary (catches errors anywhere)
├── _404.ts             → root not-found page
├── index.ts            → /
├── about.ts            → /about
└── admin/
    ├── _error.ts       → admin-section error boundary (overrides root)
    └── users.ts        → /admin/users
```

The manifest entries (abbreviated):

```ts
export const routes = [
  {
    pattern: '/admin/users',
    filePath: 'admin/users.ts',
    importFn: () => import('/abs/pages/admin/users.ts'),
    layouts: [{ filePath: '_layout.ts', importFn: … }],
    errorBoundary: { filePath: 'admin/_error.ts', importFn: … },
    // ↑ nearest in the chain — root `_error.ts` is shadowed by `admin/_error.ts`
  },
  {
    pattern: '/about',
    filePath: 'about.ts',
    importFn: () => import('/abs/pages/about.ts'),
    layouts: [{ filePath: '_layout.ts', importFn: … }],
    errorBoundary: { filePath: '_error.ts', importFn: … },
    // ↑ falls back to the root since `about/_error.ts` doesn't exist
  },
];

export const notFound = {
  filePath: '_404.ts',
  importFn: () => import('/abs/pages/_404.ts'),
};
```

The consumer pattern (user-land, three lines beyond ADR 0020's
loader):

```ts
import { lazyResource, when, html } from '@purityjs/core';
import { routes, notFound } from 'purity:routes';

async function loadStack(entry: (typeof routes)[number], params) {
  try {
    const route = (await entry.importFn()).default;
    const layouts = await Promise.all(entry.layouts.map((l) => l.importFn()));
    return layouts.reduceRight((children, mod) => () => mod.default(children), route)(params);
  } catch (err) {
    if (entry.errorBoundary) {
      const boundary = (await entry.errorBoundary.importFn()).default;
      return boundary(err);
    }
    throw err;
  }
}

function App() {
  for (const entry of routes) {
    const m = matchRoute(entry.pattern);
    if (m) return /* lazyResource around loadStack(entry, m.params) */;
  }
  // No route matched — render the manifest's notFound when present.
  if (notFound) {
    const NF = lazyResource(() => notFound.importFn().then((m) => m.default));
    NF.fetch();
    return html`${when(
      () => NF.data(),
      (Page) => Page(),
    )}`;
  }
  return html`<h1>404</h1>`;
}
```

Concretely:

- **`_error` convention**: case-sensitive base name `_error` plus
  any extension in the configured list (default `.ts` / `.tsx` /
  `.js` / `.jsx`). One per directory. Discovered alongside layouts
  in the same scan pass.
- **`_404` convention**: case-sensitive base name `_404` plus a
  configured extension. Phase 1 recognises only the routes-dir
  root (`_404.ts` directly inside the configured `dir`). Files at
  nested levels (`admin/_404.ts`) are silently skipped from the
  manifest in Phase 1 — they remain reserved for the future
  per-directory variant.
- **Nearest-wins resolution for errors**: each route's
  `errorBoundary` is the `_error.ts` deepest in its directory
  chain. Walking up: route's own dir → parent → … → routes-dir
  root. First hit wins. No chained composition (parent boundaries
  do NOT catch errors thrown inside a child boundary).
- **Module shapes** (Phase 1, intentionally loose):
  - `_error` default export: `(error: unknown) => ViewNode`. The
    boundary receives the error; it decides what to render.
  - `_404` default export: `() => ViewNode`. No params — the
    consumer reaches it only when no route matched.
- **HMR**: the existing `handleHotUpdate` (ADR 0019) invalidates
  the manifest on add / remove of any file under the routes dir.
  Adding or removing a `_error.ts` / `_404.ts` regenerates the
  manifest. In-place body edits HMR through the file's own module
  graph.
- **No runtime composer in `@purityjs/core`**: same reasoning as
  ADR 0020 — the loading-state UX of how to wire boundaries is
  app-specific (suspense? lazyResource? plain try/catch?). The
  doc snippet above is the canonical pattern.
- **Codegen surface**: `generateRouteManifestSource` now emits
  two top-level exports — `routes` (extended with the optional
  `errorBoundary` field on entries that have one) and `notFound`
  (omitted entirely when the root has no `_404`). Existing
  consumers reading just `routes[]` keep working — the new
  field on entries is optional, and `notFound` is a new export
  that consumers can ignore.

### Explicit non-features

- **No per-directory 404s.** Only the root `_404.ts` is honored in
  Phase 1. Nested 404s require runtime walking up the URL prefix
  to find the right `_404.ts` to render — non-trivial because
  the consumer needs the original URL plus the directory tree
  shape. Defer until there's a concrete app that needs it; the
  root case covers the common "blank slate" 404 page.
- **No error-boundary chaining / bubbling.** When the nearest
  `_error.ts` itself throws while rendering, the error escapes to
  the consumer (and from there to `console.error`). React-style
  parent-boundary fallbacks are a strictly larger design.
  Explicit single-level catch keeps the contract small.
- **No `notFound()` helper to throw from a route.** Next App
  Router has `import { notFound } from 'next/navigation'`; the
  thrown sentinel is caught by the framework runtime and rendered
  as the nearest `not-found.tsx`. We don't ship a runtime so we
  don't ship the helper. Apps that want this build a tiny
  user-land throw + check pattern.
- **No retry mechanism in the boundary signature.** The boundary
  is `(error) => view`; if the app wants a retry button, the
  boundary's view sets it up itself (typically a `navigate(href)`
  back to the same URL, or a manual `lazyResource.refresh()`).
  Adding a `retry` parameter ties the boundary to one consumer's
  retry strategy.
- **No 404-as-error unification (SvelteKit pattern).** SvelteKit's
  `+error.svelte` handles both 404s and thrown errors via a
  status-code switch inside the boundary. Two separate files
  (`_error.ts` / `_404.ts`) is more explicit and matches Next.
  Apps that want one file simply re-export from one to the other.
- **No status-code propagation.** The boundary doesn't get a
  status code; the renderer doesn't know what to set on the
  `Response`. Server-side renderers (`renderToString` /
  `renderToStream` / `renderStatic`) need an out-of-band way to
  signal status — likely a future ADR that extends `getRequest()`
  with a response handle. Out of scope here.
- **No layout-aware boundaries.** The boundary renders without
  the layouts that wrap the route. Wrapping layouts around the
  boundary is the consumer composer's choice; we don't force it.
  Apps that want it call the layout chain composer with the
  boundary as the leaf instead of the route.

## Consequences

**Positive:**

- Closes the recurring "blank screen on async failure" pain. One
  `_error.ts` covers everything below it.
- Matches Next App Router file naming intuitively. The reserved
  `_` prefix from ADR 0019 keeps everything orthogonal.
- Manifest stays plain data — `errorBoundary` is one optional
  field per route, `notFound` is one optional top-level field.
  Serializable, walkable, no runtime dispatch in the plugin.
- Composes with ADR 0020's lazy importFns: each boundary is its
  own module, code-split, lazy-loaded. Apps without errors never
  pay the boundary's bundle cost.
- Per-route `errorBoundary` is computed once at build time. No
  runtime walk per error.

**Negative:**

- Single-level catch (no chaining) is a deliberate simplification.
  Apps that want bubbling behavior have to wrap the boundary's
  view in their own try/catch and re-throw. Documented; the
  layout-style chain composer covers most cases.
- `_404` only at the root is restrictive. Apps with section-level
  404 pages (e.g. `/admin/missing-user` showing an admin-styled 404) have to render the right page themselves from inside the
  route. Documented as Phase 1.
- Codegen now emits two top-level exports. Existing manifest
  consumers reading just `routes` keep working, but the type
  surface is one field bigger.
- `errorBoundary` is shipped as `LayoutEntry` (not its own type)
  because the shape is structurally identical (`{ filePath,
importFn }`). Reads cleanly; risks a future divergence if
  boundary entries grow extra metadata. Re-evaluate if so.

**Neutral:**

- Two additional reserved filenames: `_error.{ts,tsx,js,jsx}` and
  `_404.{ts,tsx,js,jsx}`. The `_` prefix already excludes them
  from the route manifest (ADR 0019); this ADR claims the exact
  base names.
- `RouteEntry.errorBoundary?: LayoutEntry` is additive. Consumers
  reading only `pattern` / `filePath` / `importFn` / `layouts`
  keep working unchanged.
- Manifest top-level `notFound` is a new export, not a breaking
  change to the existing `routes` export. Consumers ignoring it
  see no behavior change.
- The plugin scan now does three passes over the file list
  (routes + layouts + boundaries) instead of two. Cost is linear
  in the number of files; negligible.

## Alternatives considered

**`ErrorBoundary` named export from any route module (Remix
pattern).** Each route defines its own boundary; no shared
hierarchy. Rejected: defeats the point of file-system convention
— sharing a boundary across siblings means re-importing it
manually in every route. The per-directory chain is the
distinguishing feature.

**One file (`_error.ts`) handles both errors and 404s (SvelteKit
pattern).** The boundary's signature would be `(error: { status:
number, message: string }) => view`. Rejected: blurs two
unrelated cases. A 404 is "no route matched" (a router event); an
error is "something threw inside a render" (an exception). Two
files keep the cases separate; apps can re-export to merge.

**Manifest emits a per-route `errorBoundaries: LayoutEntry[]`
chain (matching layouts).** Lets the consumer compose
parent-catches-child-errors. Rejected for Phase 1: encourages a
React-style bubbling design that turns boundary authoring into a
"never throws" exercise. Single-nearest is the simplest contract;
chains can be added later by extending the same field.

**Bake `notFound()` and a runtime sentinel.** Rejected: the
manifest is data, not runtime. The "throw to render the 404" UX
needs a try/catch at the dispatcher level + a sentinel class.
Apps build it in five lines if they want it; the convention
shouldn't lock anyone in.

**Per-directory `_404.ts` in Phase 1.** Tempting (matches Next).
Rejected: requires the consumer to walk the URL prefix at runtime
to find the matching directory's `_404.ts` — needs an extra
manifest field (`notFoundChain`?) plus a runtime resolver. Root
covers the common case; nested can be a follow-on ADR with a
focused manifest extension.

**`error.ts` / `404.ts` without the `_` prefix.** Mismatches
ADR 0019's convention — files without `_` are routes, so
`pages/error.ts` would map to `/error`. Rejected for consistency.

**Naming: `_500.ts` instead of `_error.ts` (matches HTTP status
codes).** Rejected: errors aren't always 5xx (a thrown TypeError
in client code isn't an HTTP status), and we'd want `_5xx.ts`
plus `_4xx.ts` plus `_404.ts` to be exhaustive. `_error.ts` +
`_404.ts` covers the common cases without committing to an HTTP-
status taxonomy.
