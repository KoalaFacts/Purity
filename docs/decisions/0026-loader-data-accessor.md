# 0026: `loaderData()` context accessor — per-component loader-data slot

**Status:** Accepted
**Date:** 2026-05-11

## Context

ADR [0022](./0022-data-loaders.md) shipped loader detection on the
manifest (`hasLoader: true`). ADR [0025](./0025-async-route-composer.md)
wired the runtime composer (`asyncRoute`) to actually call loaders
and thread their resolved data into views. The threading is positional:

- Route: `(params: Record<string, string>, data: unknown) => view`
- Layout: `(children: () => unknown, data: unknown) => view`

The positional shape is the documented Phase-1 contract — explicit and
inspection-friendly, but it locks the component signature into a
known argument order. Adding more context (loader chain, server-side
request snapshot, etc.) requires growing the argument list and
breaking existing components.

The mainstream alternative is a per-render context accessor — Remix's
`useLoaderData()`, SvelteKit's `data` prop, Solid's `useRouteData()`.
A function the component calls (without args) that returns its own
loader's resolved value. The framework populates a slot before
invoking the view; the component reads from the slot.

This ADR closes the last "user-land" non-feature in ADR 0022. The
positional arg stays as a backwards-compat fallback; new components
opt into `loaderData()`.

## Decision

**Add `loaderData<T>(): T | undefined` to `@purityjs/core`, backed by
a module-scoped stack the `asyncRoute` composer maintains.** Before
invoking each view (route, each layout, error boundary, 404), the
composer pushes the component's resolved data; after the view returns
(or throws), the composer pops. Components call `loaderData()` to read
their own slot's value.

```ts
// src/pages/users/[id].ts
import { loaderData, html } from '@purityjs/core';

export async function loader({ params, signal }) {
  return await fetch(`/api/users/${params.id}`, { signal }).then((r) => r.json());
}

export default function UserPage(params: { id: string }) {
  const data = loaderData<{ name: string }>();
  return html`<h1>${() => data?.name}</h1>`;
}
```

```ts
// src/pages/users/_layout.ts
import { loaderData, html } from '@purityjs/core';

export async function loader({ request }) {
  return { session: 'abc123' };
}

export default function UsersLayout(children: () => unknown) {
  const session = loaderData<{ session: string }>();
  return html`<aside>Session: ${session?.session}</aside>
    <main>${children()}</main>`;
}
```

The positional second arg still arrives — apps can pick either
convention. New code prefers `loaderData()`; old code keeps working.

Concretely:

- **`loaderData<T>(): T | undefined`** — reads the current slot. T is
  user-supplied; the function is structurally typed (no runtime
  type-check). Returns `undefined` when called outside a composer
  push/pop scope (e.g. in a top-level App() before asyncRoute runs).
- **The slot is a stack**, module-scoped in a new
  `packages/core/src/loader-data.ts`. Internal `pushLoaderData(value)`
  / `popLoaderData()` helpers; `asyncRoute`'s composer drives both.
  Stack semantics: each component's invocation pushes its own data;
  the layout's view runs (with its data on top), then calls
  `children()` which pushes the child's data → the child's view sees
  its own. When the child returns, the child's data pops; layout's
  view is still on top.
- **Composer changes** (in `async-route.ts`):
  - The view factory `loadStack` returns now wraps each component
    invocation in push/pop. Outside view code never sees a non-empty
    stack.
  - Error boundaries get the caught error pushed before their view
    runs — so an `_error.ts` can call `loaderData<{ error: unknown }>()`
    instead of receiving error positionally. (Phase 1 still passes
    positionally for backwards compat; Phase 2 may unify.)
  - The 404 page (`asyncNotFound`) has no loader data; its slot is
    pushed as `undefined`. Calls to `loaderData()` inside the 404
    return `undefined` as documented.
- **No reactivity.** `loaderData()` returns the captured value
  synchronously. Component code reads it inside the render frame;
  signals built from it (`compute(() => data().something)`) are the
  user's responsibility.
- **Component signature stays open.** The positional `data` arg
  remains. Components that don't read it just ignore the extra arg;
  TypeScript allows this for unused args. Apps migrating from the
  positional shape to `loaderData()` can do it route-by-route.
- **Works across renders.** Each `asyncRoute()` call → each composer
  invocation → fresh push/pop scope. Multiple `asyncRoute()` calls
  on the same page (rare, but possible if an app composes them) each
  manage their own stack frames independently because the push/pop
  is around each component-function call site.

### Explicit non-features

- **No layout-data accessor.** A `layoutLoaderData(filePath)` that
  returns a parent layout's loader output would let a deeply-nested
  view read up the chain. Useful but adds API surface — Phase 1
  ships only the "own slot" accessor. Apps that need parent data
  pass it through the layout's `children()` invocation explicitly
  or wait for a future ADR.
- **No reactive variant.** `loaderData()` is a sync accessor that
  returns the captured value. Apps building reactive derivations
  wrap it manually (`compute(() => loaderData()?.field)`). A
  reactive form would require tying the slot to a signal — overkill
  for a value that doesn't change within a render.
- **No "get current route entry" sister accessor.** The composer
  knows which entry is rendering; exposing it via
  `currentRouteEntry()` would unlock useful patterns (debug
  overlays, route-aware breadcrumbs) but adds API surface ahead of
  proven need. Apps that want this build it with `currentPath()`
  (ADR 0011) + a manifest lookup.
- **No cross-render data caching.** Each navigation reruns
  `asyncRoute` with fresh loader calls (per ADR 0025); the new
  `loaderData()` reads the freshly-resolved value. Stale-while-
  revalidate / `revalidate()` is a separate ADR.
- **No removal of the positional arg.** Both shapes coexist
  indefinitely. Apps preferring positional get a positional arg;
  apps preferring `loaderData()` ignore it. A future ADR could
  deprecate the positional arg if the ecosystem converges, but
  not now.
- **No TypeScript-typed `loaderData<keyof Manifest>()` shape.**
  Generic narrowing from the route pattern → loader return type
  needs the build-time route table emit (ADR 0019 deferred). Wait
  until that lands; then a typed variant can drop in.

## Consequences

**Positive:**

- Closes ADR 0022's last loose end. Component-data plumbing is now
  a documented framework primitive rather than a positional-arg
  convention buried in `asyncRoute`'s comments.
- Component signatures decouple from the loader pipeline. A route
  can grow its loader's return type without changing the view's
  argument list; views can read only what they need.
- Composes with `getRequest()` (ADR 0009). The two accessors share
  the same pattern (module-scoped slot, sync read) — apps see one
  shape across loader + request context.
- ~25 LOC of new code: the stack module + four push/pop sites in
  `asyncRoute`'s view factory. Existing positional arg stays a
  no-op for components that ignore it.

**Negative:**

- Two valid conventions (positional vs accessor) for the same data.
  Apps will diverge; reviewers will see both. Documented as
  intentional Phase-1 coexistence.
- The stack relies on push/pop discipline — every code path that
  invokes a view must push and pop. The composer is the only
  caller in Phase 1, so the discipline is local. If apps build
  their own composers, they need to remember to push/pop too
  (else `loaderData()` returns the wrong value or undefined).
- Module-scoped stack means no isolation between renders running
  concurrently on the same worker. Server-side this is a real
  concern (a Node server handling two requests in parallel could
  see one render's stack contaminate another). The composer's
  push/pop is synchronous within each render's view-factory
  invocation — but if the factory awaits anywhere inside the
  view, a parallel render's push happens during that await and
  `loaderData()` returns the wrong slot.
  - Mitigation: the view factories returned by `loadStack` are
    sync (loaders are awaited BEFORE the factory builds). The view
    runs synchronously. Push/pop bracket the sync invocation.
    Concurrent renders on the same isolate are safe **as long as
    the view itself doesn't `await`**.
  - The framework's component model doesn't support top-level
    `await` inside a view today — components are sync `(args) =>
view`. Reactive `resource()` / `lazyResource` calls use signal
    accessors, not awaits. So the mitigation holds.
  - Future async-component support would need a per-request
    AsyncLocalStorage in Node or per-isolate request scope in
    edge runtimes. Documented as a known limitation.

**Neutral:**

- One new export (`loaderData`) and one new internal module
  (`packages/core/src/loader-data.ts`). Tree-shakes when unused.
- Tests cover the direct push/pop semantics + the asyncRoute
  integration (a layout's view reading via `loaderData()` plus a
  route's view reading via `loaderData()` see different values).
- The example's home page in `examples/ssr/src/pages/index.ts`
  migrates to `loaderData()` to demonstrate the convention. The
  positional `data` arg stays in the function signature (unused)
  to show both shapes coexisting.

## Alternatives considered

**Pass `LoaderContext`-like object to the view as the first arg.**
Replace `(params, data)` with `({ params, data, request })`.
Rejected: changes existing signatures (breaking), and bunches
three different concepts (URL params, loader output, request
metadata) into one bag. Separate accessors per concern is cleaner.

**Use AsyncLocalStorage / async-context for proper concurrent
isolation.** Node 22 supports it; Cloudflare Workers + Deno do
not. Rejected for Phase 1: requires a runtime check and a
fallback path. The sync-view contract is enough today; ALS is the
upgrade path when async views land.

**Bind `loaderData` to the component instance via `this`.** Custom
Elements have an instance to hang state on; plain function
components don't. Forcing every loader-data component to be a
Custom Element would tie the convention to one rendering pattern.
Rejected.

**Single-slot (overwrite on each push) rather than a stack.**
Simpler but breaks the layout-renders-route-renders nested case:
layout's view runs (writes its data), then calls children, child
overwrites with route's data; child finishes, layout reads its
data again but it's been overwritten. Stack semantics are
required for nested invocation.

**Reactive `state<unknown>()` slot instead of a sync stack.**
Components could read the signal reactively. Rejected: the data
doesn't change within a render frame; making the read reactive
serves no use case and complicates the contract (subscribers
fire when the value changes between renders, but each render
gets its own resolved value — there's nothing for subscribers to
observe).

**Generate typed `loaderData<typeof manifest['/users/:id']>()`
from the build-time route table.** Requires ADR 0019's deferred
on-disk emit. Defer; the structural `<T>` generic suffices until
the manifest is a real file.

**Pass loader chain (parent + own) as a tuple.** A
`loaderData<[Layout1, Layout2, Route]>(): [...]` would let a view
walk the chain. Rejected for Phase 1: most components want only
their own data. The chain accessor is a separate ADR if real apps
want it.
