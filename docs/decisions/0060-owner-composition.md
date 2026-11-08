# 0060: Public owner composition — getOwner, runWithOwner, root

**Status:** Proposed (SV2-017; implementation slices tracked in
[the surpass-Solid ledger](../plans/surpass-solid.md))
**Date:** 2026-11-08

## Context

Purity disposes reactive work automatically when the component, effect run,
`each()` row or branch that created it goes away, and `watch()` / `onDispose()`
register with whatever owner is running. Work created _later_ — in a timer, a
WebSocket message handler, a resolved promise or a third-party subscription
callback — runs with no owner, so a `watch()` created there lives until it is
stopped by hand, and nothing says what happens after the parent is gone. The
scope stack that would let an integration re-enter an owner (`pushContext`,
`withoutScope`) is internal to `@purityjs/signals`
([SV2-017](../solid-v2-gap-analysis.md#sv2-017)). Solid v2 exposes
`getOwner()`, `runWithOwner(owner, fn)` and `createRoot(fn)`.

## Decision

A new opt-in entry `@purityjs/core/owner` exports three functions:

```ts
import { getOwner, root, runWithOwner } from '@purityjs/core/owner';

const Ticker = () => {
  const owner = getOwner()!; // this component
  socket.on('price', (p) => {
    // Bound to the component: stopped when it unmounts.
    runWithOwner(owner, () => watch(p.signal, render));
  });
  return html`…`;
};

// A cache with a deliberate lifetime, not tied to whoever created it first.
const cache = root((dispose) => ({ data: compute(() => load(id())), dispose }));
cache.dispose(); // released exactly once; further calls do nothing
```

- `getOwner(): Owner | null` returns an opaque handle for the running owner
  (component, effect run, row, branch or root), `null` outside one. Repeated
  calls in the same owner return the same handle. An effect's owner is one
  _run_: when the effect re-runs, the previous run's handle dies with it.
- `runWithOwner(owner, fn): T` runs `fn` synchronously inside `owner` and
  returns its result. Everything `fn` registers (`watch`, `compute`,
  `onDispose`, child components) is released with that owner. Reads in `fn`
  do not subscribe the caller. If the owner is already disposed, `fn` still
  runs, and everything it registered is released before `runWithOwner`
  returns — late work is never leaked and never revives a dead owner.
  `owner.alive` tells the caller in advance. Only the re-entered owner is
  visible to `fn`: the caller's owners are hidden, so component hooks
  (`onMount`, `onDestroy`, `onError`) reach the re-entered owner's component,
  never the caller's. A value that is not a handle from `getOwner()` throws
  `TypeError`.
- `root(fn): T` runs `fn` under a new detached owner that the caller's owner
  does not release. `fn` receives `dispose`, which releases everything the
  root owns exactly once (idempotent). Reads in `fn` are untracked. If `fn`
  throws, the root is released and the error rethrown.

Cleanup order inside one owner is registration order (FIFO), as for every
Purity scope; a child root registered with `onDispose(childDispose)` is
released at that point in the order.

## Acceptance tests

`packages/core/tests/owner.test.ts`:

- A later callback creates a `watch()` bound to a mounted component; it runs
  while mounted and stops on unmount.
- `runWithOwner` on a disposed root, a destroyed component, or a superseded
  effect run releases `onDispose` callbacks and watches at once.
- A root is not released by its creator's unmount; `dispose()` twice runs
  cleanup once; a throwing `fn` releases the root and rethrows.
- Nested cleanup order is recorded: `parent A, child A, child B, parent B`.
- The caller is not subscribed by reads in `runWithOwner` or `root`, and work
  re-entered into a root from inside a component render does not attach to
  that component.

## Consequences

- No change to existing entries or bytes; the new entry has its own budget
  `core-owner`.
- Intentional differences from Solid v2: cleanup within an owner is FIFO
  (Solid's owner cleanup is LIFO); `runWithOwner` on a disposed owner releases
  the late work immediately instead of leaving it unowned; there is no
  owner-tree introspection (`getOwner()` is opaque).
- Error routing is unchanged: work re-entered into a component reports to
  that component's `onError` the same way render-time work does.

## Alternatives considered

- **Export `pushContext`/`popContext`.** Rejected: unbalanced pushes corrupt
  the owner stack for every later render, and nothing stops re-entering a dead
  owner.
- **Throw when re-entering a dead owner.** Rejected: the common caller is an
  async callback racing an unmount; throwing turns a benign race into an
  uncaught error. Releasing the late work keeps the race harmless, and `alive`
  lets callers skip work deliberately.
- **Put the functions in the default entry.** Rejected: most apps never need
  them, and the default entry's budget stays unchanged.
