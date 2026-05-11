# 0028: Per-directory `_404.ts` — nested not-found chain

**Status:** Accepted
**Date:** 2026-05-11

## Context

ADR [0021](./0021-error-boundaries-404.md) shipped root-only
`_404.{ts,tsx,js,jsx}`. Nested 404 pages were explicitly deferred:

> **No per-directory 404s.** Only the root `_404.ts` is honored in
> Phase 1. Nested 404s require runtime walking up the URL prefix
> to find the right `_404.ts` to render — non-trivial because
> the consumer needs the original URL plus the directory tree
> shape. Defer until there's a concrete app that needs it; the
> root case covers the common "blank slate" 404 page.

The "concrete app" trigger landed during the manifest migration
(ADR 0025 + the `examples/ssr/` rewrite): app authors writing
nested sections (`/admin/*`, `/blog/*`) routinely want a section-
styled 404 page. Falling back to a root 404 strips the section's
chrome — surprising UX.

This ADR closes the deferred non-feature. The manifest collects
every `_404.{ts,tsx,js,jsx}` in the routes tree; the consumer's
no-match branch picks the deepest entry whose directory prefix
covers the unmatched URL.

## Decision

**Extend the manifest with `notFoundChain: LayoutEntry[]` — every
`_404.{ts,tsx,js,jsx}` in the routes tree, sorted by directory
depth (deepest first).** The existing top-level `notFound` field
stays as a back-compat alias for the root entry of the chain
(`notFoundChain[notFoundChain.length - 1]` when the root has a
`_404`). The `asyncNotFound` runtime helper accepts the chain
plus the current path and picks the deepest matching entry.

```
src/pages/
├── _404.ts               → root 404 (catches everything not matched by deeper)
├── index.ts              → /
├── admin/
│   ├── _404.ts           → admin-section 404 (catches /admin/anything-unmatched)
│   └── users.ts          → /admin/users
└── blog/
    └── _404.ts           → blog-section 404 (catches /blog/anything-unmatched)
```

The manifest emits, in addition to the existing `notFound`:

```ts
export const notFoundChain = [
  { filePath: 'admin/_404.ts', importFn: () => import('/abs/pages/admin/_404.ts') },
  { filePath: 'blog/_404.ts', importFn: () => import('/abs/pages/blog/_404.ts') },
  { filePath: '_404.ts', importFn: () => import('/abs/pages/_404.ts') },
];
```

Consumer:

```ts
import { asyncNotFound, asyncRoute, matchRoute } from '@purityjs/core';
import { notFoundChain, routes } from 'purity:routes';

export function App() {
  for (const entry of routes) {
    const m = matchRoute(entry.pattern);
    if (m) return asyncRoute(entry, m.params);
  }
  // `asyncNotFound` accepts a chain + the current path; picks deepest match.
  return asyncNotFound(notFoundChain);
}
```

Concretely:

- **Manifest field**: `notFoundChain: LayoutEntry[]` is the
  authoritative listing. Always emitted (possibly empty). Entries
  are pre-sorted by directory depth (deeper first); the existing
  alphabetical / specificity sort doesn't apply because the chain
  is walked by URL-prefix match.
- **Per-entry shape**: each chain entry needs to carry the
  directory it covers. The plugin emits `{ filePath, importFn,
dir }` where `dir` is the routes-relative directory (`''` for the
  root `_404`). The existing `LayoutEntry` type widens with an
  optional `dir?: string` field; non-404 layout entries continue to
  omit it.
- **Top-level `notFound`**: stays in the manifest output for
  backwards compatibility. When the chain has a root entry (`dir
=== ''`), `notFound` is that entry (without the `dir` field for
  shape parity with ADR 0021's emission). When no root `_404`
  exists, both `notFoundChain` may still be non-empty (nested 404s
  without a root) and `notFound` is undefined.
- **`asyncNotFound` signature widens**:
  - `asyncNotFound(entry: AsyncNotFoundEntry, options?)` — existing
    single-entry form, unchanged.
  - `asyncNotFound(chain: ReadonlyArray<AsyncNotFoundEntry>,
options?)` — new chain form. Walks the chain in order; picks the
    first entry whose `dir` is a prefix of the current path
    (`currentPath()`). Empty chain returns nothing (renders the
    fallback option if supplied, else nothing).
  - The single-entry form is a special case of the chain form
    (chain of one). Both supported.
- **Path-prefix match**: a chain entry with `dir: 'admin'` matches
  current path `/admin`, `/admin/`, `/admin/anything`, and
  `/admin/users/12`. It does NOT match `/administrator` (the path
  must continue with `/` or end). The root entry (`dir: ''`)
  matches every path.
- **HMR**: the existing `handleHotUpdate` (ADRs 0019 + 0021)
  invalidates the manifest on any add/remove under the routes
  dir. Adding `admin/_404.ts` regenerates the chain. Existing.

### Explicit non-features

- **No `_404`-level loaders.** Consistent with ADR 0022 — loaders
  on error / 404 modules are deferred. The chain entries omit
  `hasLoader`.
- **No `_404`-level layouts.** A nested 404 renders without its
  parent layouts. Wrapping the 404 in section chrome is the
  user's responsibility (typically inline in the 404's view).
  Auto-wrapping with the section's layouts is a separate ADR —
  not all apps want the section chrome on a 404, and the choice
  to wrap or not is per-route.
- **No alternative resolution strategies.** The chain walks
  deepest-first by directory prefix. No glob patterns, no
  user-supplied predicate. Apps that want different routing
  iterate the chain themselves.
- **No removal of the top-level `notFound`.** It coexists with
  `notFoundChain` for the simple single-page case. Apps with no
  nested 404s use `notFound` as before; apps with nested 404s
  switch to `notFoundChain`.
- **No automatic fallback when the chain is empty.** If the
  manifest has no `_404` files at all, `notFoundChain` is `[]`
  and `asyncNotFound(notFoundChain)` renders the options.fallback
  or nothing. Apps render their own `<h1>404</h1>` then.

## Consequences

**Positive:**

- Closes the deferred non-feature from ADR 0021. Apps with
  section-styled 404 pages no longer need to manually walk a
  manifest table.
- The chain is plain data — no runtime walking inside the plugin.
  Sort + emit at build time; resolve at consumer-side runtime.
- Backwards compatible. Existing apps using `notFound` keep
  working unchanged (it's still emitted when a root `_404` exists).

**Negative:**

- One new manifest field (`notFoundChain`). Apps reading just
  `notFound` see no change; apps that want the chain explicitly
  opt in by reading the new field. Manifest size grows by one
  entry per `_404` file (typically 1-3 per app).
- `asyncNotFound`'s signature is overloaded (single entry or
  chain array). TypeScript handles both fine; reading code has
  one more shape to recognise.
- The chain walk happens client-side every no-match. O(chainLen)
  — typically 1-5 — per render. Negligible.

**Neutral:**

- The `LayoutEntry` type widens with an optional `dir?: string`.
  Layout / error-boundary entries omit it; only `_404` entries
  populate it. No breaking change to consumers reading only
  `filePath` / `importFn`.
- The plugin's `nearestErrorDir` helper (for `_error`) and the
  new `notFoundChain` discovery are parallel concerns — `_error`
  picks the deepest in the route's chain; `_404` ranks all
  candidates so the consumer picks at runtime by URL.
- Tests in the plugin: chain-extraction unit tests for
  `buildRouteManifest`; consumer tests for `asyncNotFound`'s
  chain form.

## Alternatives considered

**Per-route `notFound: LayoutEntry` field** — assign each `RouteEntry`
its nearest `_404` the same way `errorBoundary` is assigned. Rejected:
404s fire on no-match, not from inside a matched route. There's no
"current entry" to read the field from when no route matched.

**Plugin-side path resolution** — emit a `notFoundFor(path: string):
LayoutEntry | null` function in the virtual manifest. Pushes the
walk into the plugin output, hides the chain. Rejected: the
function form ties the manifest to a one-shape API; apps that want
to inspect the chain (e.g. dev overlay) lose access. The data form

- a runtime helper is more composable.

**`_404` files with layout-style wrapping** — auto-apply the
section's layout chain to the 404 view. Rejected: not all apps
want section chrome on a 404 (a "page not found" should arguably
strip context, not preserve it). The choice is per-app; leaving
it to the 404 view's own markup is correct.

**Allow `_404.{html,md}`** — non-JS 404 sources. Rejected: out of
scope for ADR 0019's `.{ts,tsx,js,jsx}` convention. Static-asset
404 handling is a build-time concern; runtime composer stays JS.

**Take the URL prefix as a function rather than a `dir` field**
(`{ filePath, importFn, matches: (path) => boolean }`). More
flexible. Rejected: defeats the build-time-static contract; the
prefix is derivable from the filename, no need to push a runtime
predicate.

**Reverse the chain ordering** (root-first, leaf-last). Forces
the consumer to walk to the end every time. Rejected: the
deepest-first ordering lets the consumer return on first match
(80% of unmatched URLs are in a section).
