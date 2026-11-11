# 0059: Async transactions with optimistic overlays

**Status:** Proposed (SV2-007; implementation slices tracked in
[the surpass-Solid ledger](../plans/surpass-solid.md))
**Date:** 2026-11-08

## Context

`batch()` groups synchronous writes into one flush, but a change that spans
async work (save, then update the title and the timestamp from the response)
is written as separate `set()` calls after the `await`, and a tentative value
shown before the request is rolled back by hand. `optimistic()` in
`@purityjs/platform` (ADR 0049) wraps a server action with apply/rollback and
query invalidation, but it is tied to server actions and leaves overlapping
tentative values on the same signal to application code
([SV2-007](../solid-v2-gap-analysis.md#sv2-007)). Solid v2 (rc.20) actions
hold writes across transaction-safe yields, and optimistic signals show
tentative values that settle with the action.

## Decision

A new opt-in entry `@purityjs/core/transaction` exports
`transaction(fn): Promise<R>`. `fn` receives `tx`:

```ts
import { transaction } from '@purityjs/core/transaction';

await transaction(async (tx) => {
  tx.optimistic(title, draft); // shown now
  const saved = await save(draft, { signal: tx.signal });
  tx.set(title, saved.title); // applied together…
  tx.set(updatedAt, saved.updatedAt); // …in one batch
});
```

Contract (slice 1):

1. **Coherent commit.** `tx.set(state, value)` stages a write (the last one per
   signal wins). Nothing staged is visible until `fn` resolves; then every
   staged write is applied in one `batch()`, so no reader sees part of the
   update. A rejection (or a synchronous throw) discards them, and the
   returned promise rejects with the same error.
2. **Tentative values.** `tx.optimistic(state, value)` shows `value` at once
   and removes it exactly once when the transaction settles, in the same batch
   as the commit. With no commit for that signal it returns to its
   authoritative value.
3. **Overlap.** Each signal keeps a stack of tentative layers over an
   authoritative base. The newest live layer is shown; a commit from any
   transaction updates the base, which becomes visible when the last layer
   on that signal settles. A direct `state.set()` made while a layer is shown
   becomes the new base (a direct write equal to the shown tentative value
   cannot be told apart from it and is not adopted). No conflict resolution beyond this is attempted
   (server-side business conflicts stay application code).
4. **Disposal.** Called synchronously inside an owner (component setup, a
   render, a `watch()` run), the transaction is aborted when that owner is
   disposed first, or when the watch re-runs: `tx.signal` aborts, staged writes
   are discarded, tentative values are removed and the promise rejects with
   the abort reason (`AbortError`). A later settlement of `fn` is ignored. A
   settled transaction removes its disposer from the owner. Event handlers run
   outside any owner, so a transaction started from `@click` always settles;
   pass `tx.signal` to the request to make the work itself cancellable.
5. **Misuse.** `tx.set()` / `tx.optimistic()` after settlement throw
   `[Purity] transaction already settled`. Reads inside `fn` are untracked, so
   starting a transaction from a `watch()` does not subscribe it.
6. **Tracked pending count (slice 2).** `pendingTransactions()` returns the
   number of transactions that have started and not yet settled, as a tracked
   read. It rises when `transaction()` is called and falls in the same batch
   as that transaction's commit or rollback (resolve, rejection, synchronous
   throw or owner disposal), so a reader never sees the count drop before the
   committed values. The count is module-wide, not per signal; on the server
   it counts every transaction in the process, so server rendering should not
   read it.
   A `watch()` that reads the count should not also start a transaction: any
   other transaction starting or settling re-runs that watch, and the re-run
   aborts the transaction it started (point 4). Read the count in the view,
   start transactions from handlers. A transaction started under an owner
   that is already disposed is not aborted, so if its work never settles the
   count stays raised.

Intentional differences from Solid: a promise-returning function instead of a
generator (no transform, works in the JIT and strict AOT paths alike);
tentative values are layers over ordinary `state()` signals rather than a
separate optimistic signal type.

Out of scope for slices 1–2: per-signal pending state,
`store()` draft overlays, and wiring platform `optimistic()` onto these layers.

## Acceptance tests

`packages/core/tests/transaction.test.ts`: two signals written around an
`await` reach a watcher as one change (`['0:0', '1:1']`); rejection discards
writes; an optimistic value is shown, then replaced by the commit or rolled
back exactly once (`[0, 1, 0]`); overlapping overlays; a commit under another
live overlay; adopted direct writes; owner disposal; settled misuse; untracked
callback reads.
`packages/core/tests/transaction-pending.test.ts` (slice 2): the count reaches
a watcher (`0 → 2 → 0`); it falls in the commit's batch (`['a:0', 'a:1',
'b:0']`, frame order only: a decrement outside the batch is not observable
by watchers); it falls on rejection, synchronous throw and owner disposal, and never twice
(settle after disposal, disposal after settle, nested: `[1, 2, 1]`); a
`watch()` that starts a transaction is not subscribed to the count.

## Consequences

- Multi-signal updates around async work and tentative UI values need no
  hand-written rollback.
- New entry with its own budget (`core-transaction`); no existing entry grows.
- A module-level map holds an entry only while a signal has live layers.

## Alternatives considered

- **Generator actions (Solid's shape).** Needs a build transform or a
  runner that every `await` site must respect; promises compose with
  `fetch` and `AbortSignal` as written today.
- **Make `batch()` async.** Would change the semantics of every existing
  `batch()` call and hold unrelated writes made by other code.
- **Extend platform `optimistic()`.** Keeps the feature tied to server
  actions; core-level layers serve any async work and can back it later.
