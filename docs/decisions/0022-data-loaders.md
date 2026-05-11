# 0022: Data loaders — `loader` named export per route + layout

**Status:** Accepted
**Date:** 2026-05-11

## Context

ADRs [0019](./0019-file-system-routing.md), [0020](./0020-layouts.md),
and [0021](./0021-error-boundaries-404.md) ship a self-describing
route manifest with layout chains, error boundaries, and a root 404. The module shapes were left intentionally loose:

- **Routes** — `default export = (params) => view`
- **Layouts** — `default export = (children, params?) => view`
- **Error boundaries** — `default export = (error) => view`

What's missing is a server-first **data fetching** story. Today
apps wire `resource()` inside the component to fetch data; that
runs at render time and produces the SSR two-pass cycle (render
once to register pending fetches, await, render again). For a
typical "load data, then render" route the boilerplate is the
same in every component.

The shipping ecosystem has converged on **loaders** — a named
function exported alongside the route's view. The framework calls
the loader on the server before render, threads the resolved
data into the component, and avoids the two-pass cycle:

- **Remix** — `export const loader = async ({ request, params })
=> data`. Data is read in the component via `useLoaderData()`.
  Layouts get their own loaders that run in parallel with the
  route's.
- **SvelteKit** — `+page.ts` exports `load({ fetch, params })`.
  Layout-level loaders in `+layout.ts`. Data is the component's
  `data` prop.
- **Next App Router** — async server components: the route's
  default export IS an `async function Page({ params })` that
  awaits its own data. No separate loader.

Purity already has the per-directory chain machinery (ADR 0020)
and the request-scoped `getRequest()` (ADR 0009). The right
Phase-1 step:

1. Add a manifest signal — a per-entry `hasLoader: true` flag —
   so the consumer's loadStack knows which modules to await
   before rendering.
2. Document the loader signature without enforcing it. The
   consumer composer wires loader data into the component the
   way the app needs.

## Decision

**Add `hasLoader?: true` to both `RouteEntry` and `LayoutEntry`.**
The Vite plugin scans each route's and layout's source for a
named `loader` export at manifest-build time. When found, the
flag is set; consumers iterate the manifest to know which modules
need their loader called before render.

```ts
// src/pages/users/[id].ts
import { getRequest } from '@purityjs/core';
import { html } from '@purityjs/core';

export async function loader({ params, signal }) {
  const res = await fetch(`/api/users/${params.id}`, { signal });
  return res.json();
}

export default function UserPage(params, data) {
  return html`<h1>${() => data.name}</h1>`;
}
```

```ts
// src/pages/users/_layout.ts
export async function loader({ request, signal }) {
  // Layouts get their own loaders — run in parallel with the route's.
  const session = await fetch('/api/session', {
    headers: request.headers,
    signal,
  });
  return session.json();
}

export default function UsersLayout(children, params, data) {
  return html`<aside>Logged in as ${() => data.name}</aside>
    <main>${children()}</main>`;
}
```

The manifest entries (abbreviated):

```ts
export const routes = [
  {
    pattern: '/users/:id',
    filePath: 'users/[id].ts',
    importFn: () => import('/abs/pages/users/[id].ts'),
    hasLoader: true,
    layouts: [
      { filePath: 'users/_layout.ts', importFn: …, hasLoader: true },
    ],
  },
];
```

Concretely:

- **Convention**: a route or layout module exports a named
  `loader`. The plugin recognises:
  - `export const loader = ...`
  - `export let loader = ...`
  - `export var loader = ...`
  - `export function loader(...) { ... }`
  - `export async function loader(...) { ... }`
  - `export { loader }` and `export { something as loader }`
    from any module
  - The same with TypeScript type annotations
    (`export const loader: LoaderFn = ...`)
- **Detection is regex-based**, intentionally simple. The plugin
  reads each route + layout file's source once per manifest
  build (cached across routes that share the same layout). No
  parser dependency, no ReDoS — the patterns anchor at line
  start with `\s*export\s+`. False positives: a comment
  containing `export const loader = ...` would match — apps
  that hit this rename the comment.
- **`hasLoader?: true`** is optional / present-only. Omitted
  from entries without a loader so existing manifest consumers
  see no behavior change. Always literal `true` when present —
  no `false` value (consistent with the layouts ADR's "absent
  ≡ none" rule).
- **Loader signature** (documented, not enforced):
  ```ts
  type LoaderContext = {
    request: Request; // from getRequest() (ADR 0009)
    params: Record<string, string>; // from matchRoute (ADR 0011)
    signal: AbortSignal; // for cancel-on-navigate
  };
  type Loader<T = unknown> = (ctx: LoaderContext) => T | Promise<T>;
  ```
- **Component-data plumbing is user-land** in Phase 1. The
  consumer's loadStack pattern threads loader data into the
  component however the app prefers — typically as a positional
  argument (`(params, data) => view` for routes; `(children,
params, data) => view` for layouts). When apps converge on a
  shared pattern, a future ADR can ship a `loaderData()`
  context primitive. Not yet.
- **Error boundaries + 404 do not get loaders** in Phase 1.
  Loaders inside error contexts are subtle (the error might
  itself come from a loader). Defer.
- **Layout loaders run in parallel** with the route's loader by
  convention. The consumer's composer awaits a `Promise.all`
  over every entry with `hasLoader: true`. Sequential
  dependencies between layout and route loaders are not modeled
  — apps that need them sequence inside one of the two loaders.

### Explicit non-features

- **No runtime context primitive (`loaderData()`).** Apps wire
  loader data into components manually for Phase 1. Shipping a
  context primitive in `@purityjs/core` would lock the framework
  into one component-signature shape; Phase 1 stays neutral so
  the ecosystem chooses the convention. Add the primitive once
  enough apps converge on a shape.
- **No loader on error boundaries / 404 modules.** A `_error.ts`
  loader would have to run after the route's loader threw —
  awkward to design without solidifying the failure semantics.
  A `_404.ts` loader is more reasonable but less commonly needed.
  Both deferred.
- **No automatic loader-data revalidation.** Consumers re-call
  loaders on navigation (the existing route change). Per-resource
  revalidation (Remix `revalidate()`, Next `revalidatePath()`)
  is a separate ADR — needs a cache + invalidation primitive.
- **No streaming loader data.** Loaders return synchronously or
  via Promise. Async iterators / streams in loader returns are
  out of scope. Apps that need streaming use `suspense()` (ADR 0006) inside the component.
- **No loader-input validation.** Apps that want to validate
  `params` against a schema do it inside the loader (using
  Zod / Valibot / hand-rolled). The framework doesn't inject a
  validator.
- **No build-time enforcement that the `loader` export is a
  function.** The regex detects the named export; if the value
  is a string at runtime the loader call throws at the consumer.
  Catching that at build time needs a real parser pass with type
  inference. Defer.
- **No file-naming alternative** (`*.loader.ts`, `_loader.ts`).
  Loaders are co-located with their views in the same file.
  Splitting them across files would double the number of imports
  per route and lose the shared module-scope state (helpers,
  type definitions). Matches Remix / SvelteKit; rejects Next App
  Router's "the route IS the loader" pattern as too entangled.

## Consequences

**Positive:**

- Closes the boilerplate gap of "fetch data → render" routes.
  One named export per file replaces the per-component `resource()`
  - `await r.data()` pattern for the common case.
- Manifest stays plain data — `hasLoader: true` is one optional
  field per entry. Serializable, walkable, no runtime dispatch
  in the plugin.
- Composes with `getRequest()` (ADR 0009) — the loader signature's
  `request` field is the same `Request` the SSR renderers thread
  through. Cookies / headers / auth all work uniformly.
- Composes with `serverAction()` (ADR 0012) — POST handlers stay
  in `*.server.ts` modules; loaders are GET-side counterparts in
  the route module. Clear which is which.
- Layouts get loaders for free (same flag, same semantics). No
  separate convention.

**Negative:**

- Regex-based detection has false positives + negatives at the
  margins. A line `// export const loader = …` inside a comment
  triggers `hasLoader: true`; a loader assigned via re-export from
  a non-`loader`-named identifier (`export { foo as loader }` —
  detected, but `import { foo } from './x.ts'; const loader =
foo; export { loader };` — not detected) escapes detection.
  Documented; apps that need parser-grade accuracy can opt into a
  future ADR.
- Component-data plumbing is user-land. Apps will converge slowly
  on the right `(params, data)` shape. Documented; consistent
  with ADRs 0020 + 0021.
- Reading every route + layout source at manifest build time is
  one extra fs read per file. Cost is linear in the number of
  files; cached per-build. Negligible at typical scales.
- Manifest size grows by `hasLoader: true,` per entry that has
  one. ~18 bytes per loader-having entry — tiny.

**Neutral:**

- One additional optional field per entry (`hasLoader?: true`).
  Existing consumers reading `pattern` / `filePath` / `importFn` /
  `layouts` / `errorBoundary` keep working unchanged.
- The plugin's `load` hook now reads file contents in addition
  to listing names. Adds one fs call per route + layout file
  per manifest build (HMR-invalidated, so cheap).
- No new exports from the package — `hasLoader` rides on the
  existing `RouteEntry` / `LayoutEntry` types.

## Alternatives considered

**Named export as the route default (Next App Router pattern).**
The route module's default export IS an `async function` that
awaits its own data. Rejected: blurs the loader vs. view
distinction, and forces server-only code to live in the same
function as client-rendered markup. Server-only code stripping
(ADR 0018) becomes harder.

**Loader in a sibling `*.loader.ts` file.** Cleaner separation
of concerns. Rejected: doubles the file count per route, splits
shared helpers (params validation, type definitions) across two
modules, and needs an additional convention (which loader pairs
with which route?). Co-locating in the route module is the
ecosystem default.

**Build-time AST parse to verify the loader is a function.**
Catches mistakes earlier. Rejected for Phase 1: needs a parser
dependency (esbuild / oxc-parser) for what is currently a
declarative flag. The runtime call site already throws on a
non-function value with a clear stack. Add the parse later if
real-world false positives become a problem.

**Pass a loader-options bag to the plugin
(`routes: { loaderExportName: 'load' }`).** Lets apps pick a
different name. Rejected: convention beats config. The shared
name across the ecosystem is `loader`; renaming forks app
codebases into incompatible flavors.

**Implicit loader from the route's first-param shape.** If the
route's default export is `async (params) => …`, treat it as
both loader and view. Rejected: ambiguous (was the function
async because it awaits internally, or because it pre-fetches
data?). Explicit `loader` export keeps the contract crisp.

**Manifest emits the loader's source-detected key list (`{
hasLoader: { request: true, params: false, signal: true } }`)**
so the consumer knows what context fields the loader accesses.
Rejected: brittle to detect from source (especially with
destructuring rename). Apps that care about the context shape
inspect the loader at runtime.

**Ship `loaderData()` accessor in `@purityjs/core` immediately.**
A per-render context primitive that the route reads. Rejected
for Phase 1: locks one component-signature pattern in before
apps have used the manifest. Composer-passes-data-as-arg covers
the gap; the accessor can land in a follow-up once the right
shape is clear.
