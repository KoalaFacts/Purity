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
  `owner.alive` tells the caller in advance; it turns `false` as soon as the
  owner's release starts (before its other cleanups run), so work re-entered
  from a sibling cleanup is released too. Only the re-entered owner and the
  component it was captured in are visible to `fn`: the caller's owners are
  hidden, so component hooks (`onMount`, `onDestroy`, `onError`) reach the
  re-entered owner's component — also for a row or branch owner — never the
  caller's. A value that is not a handle from `getOwner()` throws
  `TypeError`.
- `root(fn): T` runs `fn` under a new detached owner that the caller's owner
  does not release. `fn` receives `dispose`, which releases everything the
  root owns exactly once (idempotent). Reads in `fn` are untracked. If `fn`
  throws, the root is released and the error rethrown. Work created directly
  in a root (or component, or effect run) whose release already ran — a root
  disposed inside its own `fn` — is released at once: a `watch()` stops after
  its first run and an `onDispose()` callback runs immediately. A `compute()`
  there stays readable and behaves like one created outside any owner, since
  releasing it before its first read would freeze it at `undefined`.

Cleanup order inside one owner is registration order (FIFO), as for every
Purity scope; a child root registered with `onDispose(childDispose)` is
released at that point in the order.

### Slice 2 — external sources: `from()` (`@purityjs/core/from`)

```ts
import { from } from '@purityjs/core/from';

const price = from<number>((set) => feed.on('price', set), 0); // on() returns off()
const user = from(userStore.subscribe); // Svelte-style store contract
```

- `from(subscribe, initial?)` calls `subscribe(set)` once, untracked, and
  returns a read accessor (`() => T`, or `() => T | undefined` without an
  initial value). `set` stores values as-is: a function value is not called
  as an updater.
- The unsubscribe function `subscribe` returns is registered with the running
  owner and runs exactly once when it is disposed — component unmount, a
  superseded effect run, a removed `each()` row, `root()` disposal, or at once
  when created through `runWithOwner` on a dead owner. `set` calls after that
  are ignored.
- Outside any owner `from()` throws a `TypeError` naming `root()`: nothing
  could release the subscription. A throwing `subscribe` propagates and
  registers nothing. On an owner already released (a root disposed inside its
  own `fn`, a destroyed component) the subscription is released at once.
- Call it in a component, an effect (`watch`) or a root, not inside a
  `compute()` body: a compute is not an owner, so its re-runs have none.
- Pull-based sources (async iterators) stay with `asyncCompute()` (ADR 0054
  slice 2), which already closes the iterator on supersession and disposal.
- Separate opt-in entry with its own budget `core-from`, so `core-owner`
  does not grow.
- Intentional differences from Solid v2: Solid's `from()` accepts producers
  and observables and works without an owner (never releasing); Purity takes
  the producer form only (an observable adapts in one line:
  `(set) => { const s = obs.subscribe(set); return () => s.unsubscribe(); }`)
  and refuses to create an unowned subscription.

## Acceptance tests

`packages/core/tests/owner.test.ts`:

- A later callback creates a `watch()` bound to a mounted component; it runs
  while mounted and stops on unmount.
- `runWithOwner` on a disposed root, a destroyed component, or a superseded
  effect run releases `onDispose` callbacks and watches at once.
- Work re-entered into a root or a row from one of its own cleanups is
  released, and a root released inside its own `fn` hands out dead handles.
- A re-entered `each()` row routes `onDestroy` and watch errors to its
  component.
- A root is not released by its creator's unmount; `dispose()` twice runs
  cleanup once; a throwing `fn` releases the root and rethrows.
- Nested cleanup order is recorded: `parent A, child A, child B, parent B`.
- The caller is not subscribed by reads in `runWithOwner` or `root`, and work
  re-entered into a root from inside a component render does not attach to
  that component.

`packages/core/tests/from.test.ts` (slice 2): template updates from pushed
values; unsubscribe exactly once on unmount, effect supersession (recorded
order `sub 1, unsub 1, sub 2, unsub 2`), `each()` row removal, `root()`
disposal, a dead owner and a root released inside its own `fn`; late values ignored; function values stored
as-is; a synchronous `set` during subscribe is the first value; reads inside
`subscribe` do not track; outside an owner it throws.

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
