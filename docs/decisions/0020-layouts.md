# 0020: File-system layouts — `_layout` per directory

**Status:** Accepted
**Date:** 2026-05-11

## Context

ADR [0019](./0019-file-system-routing.md) shipped the file-system
route manifest. Each `RouteEntry` is `{ pattern, filePath, importFn
}`; the consumer's three-line loop matches the path and calls the
matched route. That works for sibling pages (`/`, `/about`,
`/users/:id`) — but every multi-page app eventually wants
**shared chrome**: a header, a sidebar, an outer `<main>` wrapper,
maybe nested chrome in subsections. Without a layout primitive,
every route module re-imports the chrome fragments and re-renders
them on every navigation; the per-route DOM tree never adopts the
shared chrome's nodes.

The shipping ecosystem has converged on a per-directory layout
convention:

- **Next App Router** — `app/<segment>/layout.tsx`. Layouts are
  composed root-to-leaf; each layout receives `children` as a prop
  and is preserved across nested route changes.
- **Remix** — `_layout.tsx` per directory (the `_` prefix marks
  the file as not a route). Same root-to-leaf composition.
- **SvelteKit** — `+layout.svelte` per directory, with `<slot />`
  in the layout for the child route.
- **Astro** — explicit `import Layout from '../layouts/Foo.astro'`
  in the route module — Astro doesn't auto-compose. Closer to
  user-land Layouts, but still file-based.

Purity's manifest already reserves the `_` prefix (ADR 0019). The
right convention is the same as Remix / Next: `_layout.{ts,tsx,js,
jsx}` per directory inside the routes dir. The plugin walks each
route's directory chain, collects every `_layout` it finds, and
attaches the chain (root → leaf) to the route entry. The runtime
composer is a three-line `reduceRight` — apps either inline it
or wrap it.

## Decision

**Extend the manifest from ADR 0019 with a `layouts` field on each
`RouteEntry`** — an array of `{ filePath, importFn }` ordered root
→ leaf. The plugin scans for `_layout.{ts,tsx,js,jsx}` files
during the same pass that builds the route manifest; each route
inherits every `_layout` from its directory chain. No new plugin
option — layouts are discovered by convention. The runtime composer
stays user-land (a three-line `reduceRight` over the array).

```
src/pages/
├── _layout.ts          → root layout (header, footer)
├── index.ts            → /
├── users/
│   ├── _layout.ts      → users-section layout (sidebar)
│   ├── index.ts        → /users
│   └── [id].ts         → /users/:id
└── settings/
    └── index.ts        → /settings
```

The manifest entries:

```ts
[
  // / inherits the root layout only.
  {
    pattern: '/',
    filePath: 'index.ts',
    importFn: () => import('/abs/pages/index.ts'),
    layouts: [{ filePath: '_layout.ts', importFn: () => import('/abs/pages/_layout.ts') }],
  },
  // /users inherits root + users-section layouts.
  {
    pattern: '/users',
    filePath: 'users/index.ts',
    importFn: () => import('/abs/pages/users/index.ts'),
    layouts: [
      { filePath: '_layout.ts',       importFn: () => import('/abs/pages/_layout.ts') },
      { filePath: 'users/_layout.ts', importFn: () => import('/abs/pages/users/_layout.ts') },
    ],
  },
  // /users/:id inherits root + users-section layouts.
  { pattern: '/users/:id', filePath: 'users/[id].ts', importFn: …, layouts: [ … same as /users … ] },
  // /settings inherits the root layout only (no settings/_layout).
  { pattern: '/settings', filePath: 'settings/index.ts', importFn: …, layouts: [ … root only … ] },
];
```

Composing at runtime is a `reduceRight` from leaf to root — each
layout wraps the result of the inner layouts plus the route view:

```ts
import { lazyResource, when, html } from '@purityjs/core';
import { routes } from 'purity:routes';

async function loadStack(entry: (typeof routes)[number]) {
  const route = (await entry.importFn()).default;
  const layouts = await Promise.all(entry.layouts.map((l) => l.importFn()));
  return layouts.reduceRight((children, mod) => () => mod.default(children), route);
}

function App() {
  for (const entry of routes) {
    const m = matchRoute(entry.pattern);
    if (m) {
      const stack = lazyResource(() => loadStack(entry));
      stack.fetch();
      return html`${when(
        () => stack.data(),
        (Stack) => Stack(m.params),
      )}`;
    }
  }
  return html`<h1>404</h1>`;
}
```

Concretely:

- **Convention**: `_layout.{ts,tsx,js,jsx}` per directory under the
  routes dir. The reserved `_` prefix already drops the file from
  the manifest's route entries (ADR 0019 — unchanged); layouts are
  recognised by the exact base name `_layout` (case-sensitive).
- **Layout module shape**: default export is a function that takes
  `children` (and optionally `params`) and returns a view node. Phase 1
  doesn't pin the exact `children` type — the consumer composer decides
  whether to pass a thunk or an already-built node, so the `unknown`
  return type on `importFn` matches what ADR 0019 ships for routes.
- **Layout chain order**: root → leaf. The root `_layout.ts` (at
  the routes-dir root) is always first if it exists; the layout
  in the route's own directory is last. Walking up from the route
  and reversing.
- **No layout means no entry**: routes in directories without any
  `_layout.ts` along the chain have `layouts: []`. The composer's
  `reduceRight` short-circuits; the route renders bare. A consumer
  can treat this as "render with the default chrome" or "render
  raw" — manifest is data, not policy.
- **Layout-only directories**: a directory containing only a
  `_layout.ts` (no routes) is still scanned — its `_layout` is
  inherited by routes in nested directories. Such a layout simply
  doesn't appear in any chain that doesn't pass through that
  directory.
- **HMR**: the existing `handleHotUpdate` already invalidates the
  manifest on add/remove under the routes dir (ADR 0019). Adding
  or removing a `_layout.ts` invalidates the same way. In-place
  edits to a layout's body HMR through the layout's own module
  graph; no manifest regen needed.
- **No new plugin option**: layouts are convention-discovered, not
  configured. Apps that don't want them simply don't add `_layout.ts`
  files; their route entries get `layouts: []`.

### Explicit non-features

- **No built-in composer in `@purityjs/core`.** The `reduceRight`
  pattern is three lines; shipping it would lock apps into one
  loading-state UX (suspense? lazyResource? plain Promise?). When
  enough apps have written the same wrapper we'll ship it; until
  then it's a doc snippet.
- **No error boundaries (`_error.ts`).** Separate ADR. Layouts give
  us the per-segment composition machinery; error boundaries reuse
  the same chain ("on error, render the nearest `_error.ts`'s
  default export instead of the route"). Designed together but
  shipped separately so the layouts ADR stays small.
- **No 404 conventions (`_404.ts`).** Separate ADR. Same reasoning:
  the consumer's "no match" branch is one line today; conventional
  resolution can wait until layouts are in real use.
- **No layout-level data loaders.** A `loader()` named export on a
  layout module would let parent layouts pre-fetch data before the
  route's loader runs. That's the loader ADR; needs to be designed
  alongside the route loader in the same ADR. Out of scope here.
- **No "skip parent layout" escape hatch.** Next App Router has
  `route groups` (`(group)/`) that share a URL prefix without
  inheriting that group's layout. Useful but adds a second
  convention. Apps that need to bypass a layout currently move the
  route to a sibling directory. Revisit when there's a real use case.
- **No layout-relative path resolution.** The layout's `importFn`
  uses an absolute path the same way route entries do; relative
  imports inside a layout module work the way they always do via
  Vite's resolver.
- **No automatic `<slot>` injection.** Custom Elements have native
  `<slot>`; plain function components don't. The layout receives
  children as a function argument and decides where to render it.
  Symmetric with how `each(items, (item) => …)` already works.

## Consequences

**Positive:**

- Closes the recurring pain of duplicated chrome across route
  modules. One `_layout.ts` per directory; the manifest does the
  walking.
- Convention matches Remix / SvelteKit / Next App Router. Anyone
  arriving from those frameworks reads `_layout.ts` and knows what
  it does.
- Manifest stays plain data — `layouts` is a per-entry array,
  serializable, walkable. No runtime dispatch in the plugin.
- Composes with ADR 0019's lazy importFns: each layout is its own
  module, code-split automatically by Vite / Rollup, parallel-loaded
  via `Promise.all` in the consumer's loader.
- Per-route layout chains are computed once at build time. Runtime
  cost is the `Promise.all` for the layouts the route needs — no
  more, no less. No re-walk per navigation.

**Negative:**

- The `RouteEntry.layouts` field is unconditional — even routes
  without any layouts have `layouts: []`. Manifest size grows by a
  small constant per route. Negligible (a JSON-stringified empty
  array adds 12 bytes per route).
- The layout module shape is intentionally loose — `unknown` on
  the importFn return type. Apps without a shared convention will
  drift. A future ADR (loaders + typed manifests) tightens it.
- Composer is user-land. Apps that don't read this ADR's example
  may write subtly different composers — passing `params` as a
  positional arg vs. via a named field, building children eagerly
  vs. lazily. Documented and small enough to converge organically.
- Layouts and the routes-dir root case interact: the root
  `_layout.ts` lives in the same directory as `index.ts`, so the
  root route's chain has one entry while a sibling-of-root subroute
  with no nested layout has the same one-entry chain. Expected;
  documented.

**Neutral:**

- One additional reserved filename: `_layout.{ts,tsx,js,jsx}`. The
  `_` prefix already excludes underscored files from the route
  manifest (ADR 0019); this ADR claims `_layout` specifically.
- New per-entry field `layouts: LayoutEntry[]`. Existing consumers
  reading only `pattern` / `filePath` / `importFn` keep working —
  the field is additive.
- The plugin scan now does two passes over the file list (routes
  - layouts) instead of one. Cost is linear in the number of
    files; negligible.

## Alternatives considered

**Layouts in user code via explicit `import Layout from
'./layout.ts'`** in each route module (Astro pattern). Rejected:
defeats the point of file-system convention — every nested route
re-states its own chain manually, and refactoring requires editing
every leaf. Astro's tradeoff is intentional (route modules are
HTML-shaped); Purity routes are JS-shaped, so the convention wins.

**Layouts as a separate `layouts/` directory parallel to `pages/`,
with a `layoutFor(pattern)` helper.** Decouples layouts from
hierarchy. Rejected: the per-directory convention is what makes
layouts auto-compose; pulling them out of the tree means apps have
to wire each route to its layout chain by hand. The whole point.

**Manifest emits a separate `layouts` top-level array indexed by
route id.** Avoids per-entry duplication when many routes share
the same chain. Rejected: per-entry chain is simpler to consume
(no second lookup) and the duplication is small. Re-evaluate if
manifest size becomes a problem.

**Ship a built-in `composeLayouts(entry, params)` helper in
`@purityjs/core`.** Skipped for Phase 1. The composer's loading-
state UX is opinionated (does it use `lazyResource`? `resource`?
plain `Promise`? does it await all layouts in parallel or
sequentially?). Apps will diverge until enough patterns crystallize.
Three lines of user code is not the bottleneck.

**Naming: `+layout.ts` (SvelteKit) instead of `_layout.ts`.**
SvelteKit uses `+` because `_` already means "not a route" in their
ecosystem. Purity already uses `_` to mean "not a route" via ADR
0019; adding `+` would introduce a second prefix convention with
identical semantics. Rejected for consistency.

**Naming: `layout.ts` (Next App Router) without prefix.**
Rejected: ADR 0019's reserved-prefix rule is what keeps `_layout.ts`
out of the route manifest. Without a prefix, `pages/users/layout.ts`
would map to `/users/layout` — surprising. Next App Router avoids
this because route segments are directory-named; we use file-named
routes (matches Astro / Remix flat).

**Layout receives `<slot>` instead of a children function.**
Symmetric with Custom Elements' native `<slot>` (Purity's
`component()` already supports it). Rejected for plain function
layouts: `<slot>` only works inside a Custom Element's shadow tree.
Forcing layouts to be Custom Elements would couple the convention
to one rendering pattern. The function-call form composes with
both plain-function and Custom-Element layouts.
