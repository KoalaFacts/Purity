# 0054: Async derivation through the reactive graph

**Status:** Proposed (SV2-003; implementation slices tracked in
[the surpass-Solid ledger](../plans/surpass-solid.md))
**Date:** 2026-11-06

## Context

`compute()` caches whatever its function returns, including a `Promise`.
`resource()` exposes `data`, `loading` and `error` as separate accessors, so
`data()` is `undefined` before the first fetch resolves. A fetched value
therefore cannot feed an ordinary synchronous `compute()` chain without each
consumer checking `undefined` and `loading()` by hand
([SV2-003](../solid-v2-gap-analysis.md#sv2-003)).

Solid v2 (rc.20) lets a memo return a `PromiseLike` or `AsyncIterable`;
reading an unresolved memo propagates "not ready" through downstream memos
until a `Loading` boundary handles it.

Purity's `compute()` already caches a thrown error, rethrows it to every
reader, and recomputes when a source version changes. An unresolved read can
reuse that path instead of adding a second propagation mechanism to the hot
signal graph.

## Decision

Add `asyncCompute(fn)` in an opt-in entry, `@purityjs/core/async`, with its
own bundle budget. `@purityjs/signals` and the existing core entries do not
change.

```ts
import { state, compute } from '@purityjs/core';
import { asyncCompute, isPending } from '@purityjs/core/async';

const id = state(1);
const user = asyncCompute(({ signal }) => fetchUser(id(), { signal }));
const greeting = compute(() => `Hello, ${user().name}`); // a plain sync compute
```

Contract:

1. **Tracking.** `fn` is tracked like `compute()` until it returns; reads after
   the first `await` are not tracked. A change to a tracked read starts a new
   run.
2. **Unresolved reads.** Until the first run settles, reading `user()` throws a
   `PendingError` (exported; `isPending(err)` tests for it). A downstream
   `compute()` caches and rethrows it like any other error, so no `undefined`
   and no `Promise` reaches application code as resolved data. When the value
   settles to a new value, downstream readers re-run; a run that settles to a
   value `Object.is`-equal to the current one keeps the current outcome, so
   downstream readers (including a chained `asyncCompute`) do not re-run.
3. **Retained content.** After a run has settled once, a later run keeps the
   previous outcome (value, or rejection) while it is in flight;
   `user.pending()` (tracked) is `true` meanwhile. Only the very first load
   throws `PendingError`. Readers depend on the outcome, not on run starts, so
   a run that has not settled yet does not re-run downstream derivations.
4. **Supersession.** Each run gets a fresh `AbortSignal`; starting run B aborts
   run A's signal. A settlement from any run other than the latest is
   ignored, so if A resolves after B only B becomes current. A superseded
   run's rejection is dropped without logging: it is a stale result, not an
   error of the current value.
5. **Rejection.** A rejected run that is still the latest becomes the current
   outcome: reading throws the rejection reason (downstream computes cache
   it) and `pending()` is `false`. A rejection caused by its own abort is
   ignored. A later successful run clears the error.
6. **Synchronous results.** If `fn` returns a non-thenable value, it settles in
   the same pull with no `PendingError`. A thenable always settles after the
   current pull, even one that calls back synchronously.
7. **Chaining.** If `fn` throws `PendingError` (it read an unresolved upstream
   async value), synchronously or as the rejection of an `async` function,
   the run stays pending rather than settling as an error; the upstream
   settlement re-runs `fn`. Only reads before the first `await` are tracked
   (as everywhere in the graph), so read upstream values before awaiting;
   an untracked unresolved read stays pending with nothing to re-run it.
8. **Disposal.** `user.dispose()`, or disposal of the owning component, row or
   watch scope, aborts the in-flight run and ignores its settlement. Reading
   a disposed accessor returns the last settled outcome, or keeps throwing
   `PendingError` if none settled; `pending()` is `false` once disposed.
   Abort listeners run synchronously inside the read that starts the next run,
   so they should not write signals.

Slice 2: `fn` may return an `AsyncIterable`. Each yielded value settles the
run like a resolved promise (so a first yield ends the initial pending state
and later yields replace the current value, with the same equality cut-off);
a rejection from `next()` becomes the current error; an iterator that ends
without yielding leaves the run pending. Supersession and disposal abort the
run, and its abort listener calls `return()` once, so async generators run
their `finally` blocks; a generator suspended on an `await` closes after that
await settles, and nothing it yields after supersession is delivered. The
first `next()` runs inside the tracked run, so a generator's reads before its
first `await` are tracked, like an async function's. Promise results keep
their timing (settled one microtask after the promise). The listener is added
with `addEventListener`, so an `onabort` set by `fn` stays in place.

Deferred to later slices of SV2-003 (each recorded in the ledger before it
ships): SSR priming through `SSRRenderContext` like `resource()`. The
view-level loading boundary belongs to SV2-004.

## Intentional differences from Solid

- **Explicit API, opt-in entry.** `compute()` keeps caching a returned
  `Promise` as a value; async behaviour is chosen with `asyncCompute`, so
  existing code and the zero-dependency signal graph are unchanged and apps
  that do not use it pay no bytes.
- **Pending is an error value.** Unresolved state travels through the existing
  cached-error path. A `watch()` whose first run reads an unresolved value
  without a guard throws `PendingError` from `watch()` like any throwing
  effect, so effects guard the read (`try` + `isPending()`) or check
  `pending()` first until the SV2-004 boundary handles it in views.
- **`AsyncIterable` closes through the run's abort.** `return()` is driven by
  the `AbortSignal` the run already has, so promises and streams share one
  cancellation path.

## Acceptance tests

- source → `asyncCompute` → `compute` → `watch`: the watch never receives
  `undefined` or a `Promise`; it first sees `PendingError`, then the value.
- Run A superseded by B, A resolving last: only B's value is ever current; A's
  signal is aborted.
- A rejection of the latest run is rethrown by downstream computes; a stale
  rejection is ignored; an abort-caused rejection is ignored.
- Refetch after a settled value: readers keep the old value and
  `pending()` is `true` until the new one lands.
- Disposal mid-flight aborts the signal and ignores the settlement.
- `asyncCompute` reading an unresolved `asyncCompute` stays pending, then
  settles from the upstream value; an upstream refetch re-runs the downstream
  only once, with the new value.
- Slice 2 (`tests/async-compute-iterable.test.ts`): every yield reaches a
  downstream `compute` → `watch`; supersession and disposal (direct or owner
  scope) call `return()` and drop later values; an async generator's `finally`
  runs; a `next()` rejection is the current error; an iterator that ends
  without yielding stays pending; reads before the first `await` are tracked;
  `fn`'s own `signal.onabort` still fires; promise timing is unchanged.

## Consequences

- A new public entry and budget; the existing entries do not grow.
- Effects and views that read async values handle `PendingError` until the
  SV2-004 boundary lands; this is documented next to the API.
