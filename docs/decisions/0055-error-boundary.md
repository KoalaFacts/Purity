# 0055: Client error fallback and reset boundary

**Status:** Proposed (SV2-006; implementation slices tracked in
[the surpass-Solid ledger](../plans/surpass-solid.md))
**Date:** 2026-11-06

## Context

Purity already routes failures through the ownership tree: a component's
`onError` receives errors from its render, lifecycle hooks and later scheduled
runs of its watches, recovery work started in the handler is owned, `match()`
retries a failed branch, and `resource()` exposes `error`/`retry`. What is
missing is a general client boundary that replaces a failed subtree with a
fallback, lets the user reset it, and passes a failing fallback outwards
([SV2-006](../solid-v2-gap-analysis.md#sv2-006)). Applications compose that by
hand today.

Solid v2 (rc.20) has `Errored`: it renders a fallback with the error and a
`reset` function in place of a failed reactive or render subtree, and a
fallback failure reaches the parent boundary. Event-handler errors are a
separate responsibility.

## Decision

Add `errorBoundary(view, fallback)` in an opt-in entry,
`@purityjs/core/boundary`, with its own bundle budget. Existing entries and
`@purityjs/signals` do not change.

```ts
import { html } from '@purityjs/core/jit';
import { errorBoundary } from '@purityjs/core/boundary';

html`<section>
  ${errorBoundary(
    () => html`<p>${() => total().toFixed(2)}</p>`,
    (error, reset) => html`<p role="alert">${String(error)}</p>
      <button @click=${reset}>Retry</button>`,
  )}
</section>`;
```

Contract:

1. **What is caught.** A throw while `view()` renders, and a throw from a later
   scheduled run of any watch, effect or template binding the view created
   (for example a binding reading a `compute()` that now throws). Owners
   created while the view renders (nested `mount()` roots, `when()`/`each()`
   branches and rows) report to the boundary when no nearer `onError` takes
   the error. A `component()` custom element is its own error unit: it finds
   its owner when it connects, after the view rendered, so its failures go to
   its own `onError` and are not caught by this slice. The view and fallback
   return a `Node`, a string or `null`.
2. **What happens.** The view's owner is disposed (its watches, `onDispose`
   callbacks and child components run their teardown once), every node between
   the boundary's `<!--eb-->` and `<!--/eb-->` markers is removed, including
   nodes nested control flow inserted, and `fallback(error, reset)` renders in
   their place. Siblings outside the boundary keep updating.
3. **Reset.** While a fallback is shown, its `reset()` disposes the fallback's
   work once and renders `view()` again in a fresh owner. A reset that fails
   again shows the fallback with the new error. A `reset()` from a fallback that
   is no longer shown, or after the boundary's owner was disposed, does nothing.
4. **Fallback failure.** A throw from `fallback()` leaves the boundary empty and
   goes to the next outer `errorBoundary`, else the surrounding component's
   `onError`. With no surrounding component it is thrown to the caller during
   the first render, and logged with `console.error` when it happens in a later
   scheduled run.
5. **Not caught.** DOM event-handler errors are not routed to the boundary;
   they reach the browser's error reporting as today.
6. **Host and lifecycle.** Inside the view and the fallback, component APIs
   (`slot()`, `css()`, `internals()`, custom states, form hooks) act on the
   surrounding component's host; tearing down a failed view or fallback never
   clears host state, so `slot()` keeps working after a failure and reset,
   inside and outside the boundary. `onMount` registered inside the view or the
   fallback runs after that content is inserted. A `reset()` called while the
   fallback is still rendering wins: the view is shown and the work the
   fallback registers afterwards is released. Disposing the boundary's owner tears down
   the current view or fallback and removes both markers.
7. **Server and hydration (slice 1).** During SSR the view renders inside
   `try`/`catch` and the fallback replaces it on a synchronous throw (no
   markers, no reset). During hydration the view hydrates without a boundary,
   so hydrated subtrees report to `onError` as before. When the server rendered
   the fallback, the client hydrates `view()` against the fallback's markup,
   which is a divergent SSR: the outcome is whatever the hydrator does for any
   mismatch (a warning under `enableHydrationWarnings()`, a fresh client render
   of the root when the walker fails). Until slice 2, a view that must hydrate
   should not rely on a server-rendered fallback. Slice 2 adds SSR boundary markers
   that record which side rendered, and hydration adoption so the client
   boundary also guards hydrated content.

### Intentional differences from Solid

- A function call inside templates, like `when()`/`match()`, not a component;
  the Web Component host stays the unit of encapsulation.
- An unresolved async read (`PendingError` from the proposed `asyncCompute()`
  of SV2-003) is an error to this boundary until the SV2-004 loading boundary
  lands; then loading boundaries see pending reads before error boundaries do.
- No automatic reset on input changes in this slice: the failed view's
  dependencies are disposed with it. Applications reset from the fallback (a
  button, or a `watch()` in the fallback that calls `reset()`).

## Acceptance tests

`packages/core/tests/error-boundary.test.ts` and
`packages/ssr/tests/control-flow.test.ts` (`errorBoundary() on the server`):
a later derived-value throw replaces only the boundary while a sibling keeps
updating; a synchronous render throw; reset disposes failed and fallback work
once and a stale reset is a no-op; a reset that fails again; a throwing
fallback reaches an outer boundary, or the component `onError` with no outer
boundary; nested `when()` nodes are removed; `onMount` in view and fallback;
owner disposal and disposal of an enclosing `when()` branch; host `slot()`
inside the view, and after a failure and reset; a form hook registered in the view; a `reset()` from inside the fallback render; a nested failure
in an inner fallback; work registered after a nested failure is released;
event-handler errors are not caught; no surrounding component; the README
template example; SSR view and fallback output.

## Consequences

- Retry UI and subtree replacement stop being application code.
- Opt-in bytes only: apps that do not import the entry pay nothing.
- Until slice 2, content hydrated from SSR is not guarded by a client boundary;
  its errors reach `onError` as before. Client-rendered boundaries (CSR apps,
  content rendered after hydration) are fully guarded.

## Alternatives considered

- **A `when()`-style option on existing control flow.** Would add bytes to
  every app using `when()`/`match()` and mix two responsibilities.
- **Catching in `component()` only.** Components already have `onError`; the
  gap is replacing a part of a component's DOM without a new custom element.
