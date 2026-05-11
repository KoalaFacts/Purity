# 0019: File-system routing — manifest generation

**Status:** Accepted
**Date:** 2026-05-11

## Context

ADR [0011](./0011-router-primitives.md) shipped `currentPath()`,
`navigate()`, and `matchRoute()`. They cover ~80% of the value of a
router for apps with a handful of routes — one `if (matchRoute(…))`
per route. They scale poorly: every new route is a manual edit to the
dispatcher, every route module is a manual `import` at the top of
`app.ts`, and every code-split boundary is a manual `() => import(…)`
wrapper. That's the same boilerplate ADR 0011 noted but didn't close.

The shipping ecosystem has converged on **file-system routing** for
this — a directory whose layout becomes the route table:

- **Next App Router** — `app/<segment>/page.tsx` + `[id]` for params,
  `[...slug]` for splats. Layouts via `app/<segment>/layout.tsx`.
  Build-time scan emits a route tree consumed by the framework's
  `<Router>` component.
- **Remix** — `app/routes/<segment>.tsx` (flat) or nested directories.
  `_layout.tsx` for nested layouts. Build-time scan via `@remix-run/dev`.
- **SvelteKit** — `src/routes/<segment>/+page.svelte`, with sibling
  `+layout.svelte` for layouts and `+page.ts` for loaders. Build-time
  scan via `@sveltejs/kit/vite`.
- **Astro** — `src/pages/<segment>.astro` + `[id].astro` + `[...slug].astro`.
  Build-time scan via Astro's Vite plugin.

The shape is stable across frameworks: a directory of route modules,
a small set of filename conventions for dynamic / splat / index, a
build-time scan that produces a manifest the runtime router walks.
The variation is in the bells (layouts, loaders, error boundaries,
loading states, parallel routes, intercepting routes) — none of which
Purity needs in Phase 1.

The smallest correct thing: a Vite plugin pass that scans a `pages/`
directory, derives a route pattern from each filename, and emits a
virtual `purity:routes` module exporting a sorted array of
`{ pattern, importFn }` entries. Apps consume it with the existing
`matchRoute()` primitive. Layouts, loaders, error boundaries, 404s
become follow-up ADRs once the manifest exists to hang them on.

## Decision

**Add a `routes` option to `@purityjs/vite-plugin` that, when
configured, scans a directory at dev / build time and exposes a
virtual module (`purity:routes` by default) with a sorted route
manifest.** Off by default — opt in by passing
`routes: { dir: 'src/pages' }` (or `routes: true` for `pages/` at
the project root). Phase 1 ships only the manifest; the router is
the existing `matchRoute()` primitive.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { purity } from '@purityjs/vite-plugin';

export default defineConfig({
  plugins: [purity({ routes: { dir: 'src/pages' } })],
});

// src/app.ts
import { currentPath, matchRoute, html } from '@purityjs/core';
import { routes } from 'purity:routes';

export function App() {
  // Walk the manifest top-to-bottom, take the first match.
  for (const entry of routes) {
    const m = matchRoute(entry.pattern);
    if (m) return AsyncRoute(entry, m.params);
  }
  return html`<h1>404</h1>`;
}
```

```
src/pages/
├── index.ts           → /
├── about.ts           → /about
├── users/
│   ├── index.ts       → /users
│   ├── me.ts          → /users/me        (static beats dynamic — sorted first)
│   └── [id].ts        → /users/:id
└── blog/
    └── [...slug].ts   → /blog/*
```

Concretely:

- **`routes?: boolean | RoutesOptions`** plugin option. `false`
  (default) disables the scan entirely. `true` is shorthand for
  `{ dir: 'pages' }`.
- **`RoutesOptions`** fields:
  - `dir: string` — path to the routes directory, relative to Vite's
    project root.
  - `extensions?: string[]` — file extensions counted as route
    modules. Default `['.ts', '.tsx', '.js', '.jsx']`. Files outside
    this list are ignored (so `_layout.css`, `README.md`, etc.
    don't pollute the manifest).
  - `virtualId?: string` — virtual-module specifier. Default
    `'purity:routes'`. Override only if it collides with another
    plugin.
- **Filename → pattern grammar** (the only convention users learn):
  - `index` (any allowed extension) → directory's path itself
    (`pages/index.ts` → `/`, `pages/users/index.ts` → `/users`).
  - `[name]` → `:name` (single dynamic segment, captured under
    `params.name`).
  - `[...rest]` → `*` (splat — must be the last segment; captured
    under `params['*']`). The name inside the brackets is currently
    ignored — splat is always under `*` to match `matchRoute()`'s
    grammar (ADR 0011). We may revisit per-name splats once `matchRoute`
    grows them.
  - Any other segment is a literal.
  - Files prefixed with `_` (e.g. `_layout.ts`, `_404.ts`) are
    **reserved** — they're skipped from the manifest. Phase 1 doesn't
    use them; future ADRs (layouts, error boundaries) will.
- **Sort order** (most specific first, so the consumer's first-match
  loop does the right thing):
  1. Routes with more literal segments win.
  2. Among ties, fewer dynamic params win.
  3. Splat routes (`*`) sort last.
  4. Final tiebreaker: alphabetical on the pattern.
- **Manifest shape** (the virtual module):
  ```ts
  export interface RouteEntry {
    pattern: string; // e.g. '/users/:id'
    filePath: string; // relative to the routes dir, with extension
    importFn: () => Promise<unknown>;
  }
  export const routes: RouteEntry[];
  ```
  Each `importFn` is a static `() => import('/abs/path/to/route.ts')`,
  so Vite / Rollup code-split each route into its own chunk
  automatically. The `unknown` return type is intentional — Phase 1
  doesn't prescribe a route-module export shape (default function?
  named `Page`?). Apps cast as needed; a future ADR can tighten
  this once layouts / loaders pin the shape.
- **HMR**: the plugin invalidates the virtual module when a file is
  added to or removed from the routes dir. In-place edits to a route
  module already HMR through their normal module graph; only
  add/rename/delete forces a manifest regen.
- **No-route-dir tolerance**: the plugin loads the virtual module
  with an empty `routes: []` if the configured dir doesn't exist,
  rather than throwing. Lets apps wire the plugin into a starter
  before adding the first page.

### Explicit non-features

- **No layouts.** No `_layout.ts` nesting, no shared boundaries between
  parent and child routes. The reserved `_` prefix leaves room for it
  in a follow-up ADR.
- **No data loaders.** No `loader()` export, no per-route data
  pre-fetch, no waterfall coordination. Apps continue to use
  `resource()` inside the route component for now.
- **No error boundaries / 404 conventions.** Apps render their own
  fallback when the consumer loop doesn't find a match (see the
  example above). A future ADR can add `_404.ts` / `_error.ts` once
  the layout primitive lands (the two compose).
- **No `<Route>` / `<Routes>` component.** The manifest is data; the
  consumer loop is three lines. Wrapping that in a component would
  hide the data and lock apps into a specific suspense / loading
  pattern. Apps that want the abstraction write a five-line wrapper.
- **No async-component primitive.** The example's `AsyncRoute` helper
  is user-land — typically a `lazyResource()` wrapping the
  `entry.importFn()` call plus a `when()` on its data state. We don't
  ship a built-in because the loading / error UX is app-specific.
- **No build-time route table emit.** The manifest stays virtual.
  Emitting it to disk would give the user a file to commit / lint
  but obscures that the source of truth is the directory layout.
  A future ADR can add `--emit-routes <path>` if the demand exists
  (e.g., for static analysis or a typed route helper).
- **No typed route params.** Returning `Record<string, string>` from
  `matchRoute()` is the same shape ADR 0011 ships. Generating a
  `RouteParams<'/users/:id'>` type from the pattern is a TS template-
  literal exercise — out of Phase 1 scope.
- **No route groups / parallel routes / intercepting routes.**
  Next App Router-specific features. Add only when there's a
  concrete Purity use case.

## Consequences

**Positive:**

- Closes the recurring pain from ADR 0011: every route is one file,
  every route is auto-code-split, the `App` component is a three-line
  loop instead of a growing `if/else` ladder.
- Convention is intentionally near-Astro / -Next: anyone arriving from
  a file-system router doesn't need to learn new symbols. `[id]` and
  `[...slug]` both work.
- Manifest is plain data. Server renderers (`renderToString` /
  `renderStatic`) iterate the same array as the client — no
  separate server router to keep in sync.
- Build-time scan + virtual module means zero runtime fs reads. The
  code that ships to the browser is the manifest array + the
  `import()` glue Vite generates anyway.
- Composes with ADR 0010 (`renderStatic`): an SSG driver iterates
  `routes` to produce a `paths` array. Static routes go through
  unchanged; dynamic / splat routes need an explicit `paths` callback
  per the ADR 0010 contract.

**Negative:**

- Apps have to learn one new convention (`[id]`, `[...slug]`,
  `index`). It's small and matches the ecosystem default — but it's
  one more thing.
- The `_` reserved prefix is a deliberate land-grab for future ADRs.
  Apps that already name files `_helpers.ts` inside `pages/` will
  see them silently dropped from the manifest. Documented; the
  convention is consistent with Remix / Next / SvelteKit.
- The manifest is virtual. Tools that walk the project file tree
  (linter / `tsc --noEmit` / IDE jump-to-def) won't see a routes
  file. Vite's HMR + the IDE plugin handle the dev case; CI
  compatibility is the user's responsibility (point at the source
  files, not the manifest).
- No route-module shape contract. Apps doing `entry.importFn().then(m
=> m.default(params))` will diverge from apps doing `m.Page(params)`.
  Phase 1 leaves that open intentionally — the right shape will fall
  out of the layouts ADR.

**Neutral:**

- One new plugin option (`routes`). Off by default — existing apps
  see no behavior change. Opt in by passing `{ dir: 'pages' }` (or
  `true` for the same default).
- One new virtual module specifier (`purity:routes`). Configurable
  to avoid collisions, but the namespace prefix (`purity:`) reserves
  it for future virtual modules without further config surface.

## Alternatives considered

**Use `import.meta.glob('./pages/**/\*.ts')` directly in user code.\*\*
No plugin needed; Vite already supports it. Rejected: forces every
consumer to write the sort + pattern derivation themselves, which
defeats the point of a shared convention. Splats and dynamic
segments need real parsing, not a regex on the import key.

**Generate the manifest to a real file (`src/.purity/routes.ts`).**
Matches Remix `.cache/` and Next `.next/` patterns. Rejected for
Phase 1: requires a `.gitignore` entry, requires the file to exist
before `tsc` runs (chicken-and-egg in CI), and the virtual module
has identical ergonomics with no on-disk artefact. Re-evaluate if
typed route params land — a real file gives `tsc` something to
inspect.

**Configurable filename grammar via plugin options
(`paramSyntax: ':name' | '[name]'`).** Rejected: convention beats
config. The `[name]` / `[...rest]` syntax is the cross-framework
default; supporting two grammars doubles the test matrix and
confuses readers of any given codebase.

**Route table as a flat object keyed by pattern (`Record<string,
ImportFn>`)**, not an array. Rejected: object key order is
implementation-defined for non-integer keys, so the consumer's
"first match wins" loop would have undefined behavior. An array
keeps sort order explicit and JSON-stringifiable for debugging.

**Auto-mount the router (`<purity-routes>` Custom Element shipped
with the plugin).** Rejected: the consumer loop is three lines,
exposing it as data is more flexible (apps can compose with their
own layout, error boundary, loading state without fighting the
framework), and a wrapper element would couple the plugin to the
runtime in a way it isn't today.

**Filename convention: `pages/users.tsx` → `/users` (no `index`).**
Astro / Next App Router both use `index` for directory roots; we
match. The flat alternative makes `pages/users.tsx` and
`pages/users/me.tsx` ambiguous (does the first own `/users`, or
does it also own `/users/`?). The `index` convention is unambiguous.
