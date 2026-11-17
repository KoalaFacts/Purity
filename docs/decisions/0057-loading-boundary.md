# 0057: Client loading boundary with retained content

**Status:** Proposed (SV2-004; implementation slices tracked in
[the surpass-Solid ledger](../plans/surpass-solid.md))
**Date:** 2026-11-08

## Context

`asyncCompute()` (ADR [0054](./0054-async-derivation.md)) throws `PendingError`
from a read that has never settled and keeps the previous value while a
refetch is in flight. Nothing turns that into a loading state: `suspense()`
renders the view directly on the client, so an application that reads an
unresolved value either crashes into its `onError`/`errorBoundary()` or
assembles a fallback by hand ([SV2-004](../solid-v2-gap-analysis.md#sv2-004)).

Solid v2 (rc.20) has `Loading`: it shows a fallback while reads inside it are
unresolved and keeps committed content during an ordinary refetch; `Reveal`
coordinates the order in which sibling boundaries appear, and `isPending`
describes unrevealed changed state.

## Decision

Add `loading(view, fallback)` in an opt-in entry, `@purityjs/core/loading`,
with its own bundle budget (`core-loading`). `PendingError` gains an optional
`source` (the `asyncCompute()` value whose read threw); `@purityjs/core/async`
stays within its budget and no other entry grows. `errorBoundary()` and
`loading()` share one internal host-forwarding scope (`hosted-context.ts`).

```ts
import { asyncCompute } from '@purityjs/core/async';
import { loading } from '@purityjs/core/loading';

const user = asyncCompute(({ signal }) => fetchUser(id(), { signal }));

html`<section>
  ${loading(
    () => html`<h2>${() => user().name}</h2><input placeholder="Note" />`,
    () => html`<p aria-busy="true">Loading…</p>`,
  )}
</section>`;
```

Contract (slice 1):

1. **Initial load.** `view()` renders in its own owner. If it throws a
   `PendingError` (a template binding's first run reads an unresolved value),
   that attempt is disposed, `fallback()` renders between `<!--ld-->` and
   `<!--/ld-->` markers, and the boundary waits for the error's `source` to
   stop being `pending()`. Then it renders `view()` again in a fresh owner; a
   render that is still pending keeps the same fallback and waits again. When
   a render completes, the fallback is disposed and the view is shown.
2. **Retained content.** Once shown, the view is never replaced by the
   fallback. A refetch keeps the retained value (`asyncCompute()` semantics),
   so the DOM nodes, focus and edited input state survive; `value.pending()`
   is the visible-feedback hook while the refetch is in flight.
3. **Errors.** A non-pending throw from the first render is thrown to the
   caller. A rejection or other throw from a re-render after waiting goes to
   the surrounding component's error chain (an enclosing `errorBoundary()`, else
   `onError`), and is logged with `console.error` when nothing takes it; the
   boundary is left empty. A `PendingError` from a binding of content that is
   already shown goes the same way: wrap content created later (a new
   `when()` branch reading a new async value) in its own `loading()`.
4. **No live source.** A `PendingError` without a `source`, or whose source is
   disposed, keeps the fallback (nothing will settle).
5. **Disposal.** Disposing the boundary's owner stops the wait, tears down the
   view or fallback once and removes both markers; a settlement after that
   renders nothing.
6. **Host and lifecycle.** As for `errorBoundary()`: component APIs inside act
   on the surrounding host, `onMount` runs after the content is inserted.
7. **Server and hydration.** During SSR the fallback replaces a view that reads
   an unresolved value (no markers); other errors propagate. During hydration
   the view hydrates without a boundary. Streaming the resolved view, and
   hydration adoption, are later slices.

### Intentional differences from Solid

- A function call inside templates, like `errorBoundary()`, not a component.
- Waiting is driven by the throwing value's `source.pending()`; reads of
  `resource()` do not throw `PendingError` and keep their own `loading()`
  signal.
- No `Reveal` coordination yet (slice 2): two sibling boundaries reveal
  independently as their values settle.
- Composition order: `errorBoundary(() => loading(…), …)` catches the
  rejections `loading()` passes on. An `errorBoundary()` inside a `loading()`
  view still treats a pending read as an error (ADR 0056) until a later slice.

## Acceptance tests

`packages/core/tests/loading.test.ts`: nothing pending renders at once;
initial fallback then view; refetch retains the complete view, the same input
node and its edited value; pending attempt and fallback released once with
`onMount` order; a chain of async values; rejection to an enclosing
`errorBoundary()`, to `onError`, and to `console.error`; synchronous non-pending
error thrown to the caller; a `PendingError` with no source keeps the
fallback; owner disposal before settlement; inside a JIT template with a
sibling binding. `packages/core/tests/async-compute.test.ts`: `PendingError`
names its source through a `compute()`. `packages/ssr/tests/control-flow.test.ts`
(`loading() on the server`).

## Consequences

- Initial loading UI stops being application code, and refetches keep user
  state without extra work.
- Opt-in bytes only (`core-loading`); apps that do not import the entry pay
  nothing.
- A pending attempt renders the view once and throws it away; views that do
  expensive work before their first async read pay that per settlement.

## Alternatives considered

- **Use `suspense()`'s fallback on the client.** `suspense()` is the SSR
  streaming boundary; changing its client meaning affects every app using it,
  and it has no async-read signal to wait on.
- **Keep the pending attempt alive and reveal it when its bindings settle.**
  A binding whose first run throws is disposed by the signal graph, so the
  attempt cannot finish itself; re-rendering is the smaller, correct slice.
- **Retry on any settlement of any async value.** Simpler, but every
  settlement would re-render every waiting boundary; the `source` field costs
  a few bytes in `@purityjs/core/async`.
