# 0054: Add a property-granular store as an opt-in core entry

**Status:** Proposed
**Date:** 2026-11-06

## Context

A `state()` holds one `Object.is`-compared value. Nested forms and entity
collections either replace the whole object (every reader reruns) or are
hand-split into one signal per field. Solid v2 (rc.20) ships proxy stores
with draft updates (`createStore`) and keyed snapshot adoption
(`reconcile`, projections). This is ledger row SV2-005 in
[`docs/plans/surpass-solid.md`](../plans/surpass-solid.md).

## Decision

Add `store(initial)` in the new opt-in entry `@purityjs/core/store`, built
only on the public `state`/`batch`/`untracked` primitives, so the signal
graph and every existing entry stay byte-for-byte unchanged.

- `store(obj)` returns `[view, update]`. `obj` must be a plain object or
  array (`TypeError` otherwise). The store adopts the object; it does not
  clone it.
- **Reads.** `view` is a read-only proxy. Reading a property tracks one
  version signal for that (object, property). `in`, `Object.keys`,
  `for…in` and other own-key reads track one structural signal per object.
  Array `length` is an ordinary tracked property. Plain objects and arrays
  are wrapped on read (one cached proxy per object, so `view.a === view.a`);
  other objects (Date, Map, class instances) are returned as they are.
- **Writes.** Assigning, deleting or defining through `view` throws a
  `TypeError`. `update(draft => …)` runs the callback untracked inside one
  `batch()`, so effects see all of its writes once. A write equal by
  `Object.is` notifies nobody. Adding or deleting a key bumps the structural
  signal; array writes that change `length` bump `length`, the structural
  signal and every dropped index. Store values assigned into a draft are
  stored as their plain objects, never as proxies.
- **Not supported in slice 1:** frozen objects or non-writable properties
  inside a store (proxy invariants forbid returning a wrapped view for them).
- **Errors.** A throwing `update` keeps the writes made before the throw
  (no transaction rollback), notifies their readers and rethrows.
- **Disposal.** Signals are created lazily on first read and are held in
  `WeakMap`s keyed by the raw objects, so a dropped store, or an object
  removed from it, is collected with its signals. Nothing is owned by a
  component scope.

### Intentional differences from Solid

- Setter is a draft callback only (no path-setter overloads), one API.
- No rollback on a throwing update; transactions belong to SV2-007.
- Keyed adoption of server snapshots (`reconcile`-style, by a selected key)
  and SSR serialization are deferred to slice 2 of this ADR.

## Acceptance tests

`packages/core/tests/store.test.ts`: a nested write reruns only readers of
that property; equal writes (including `NaN`) notify nobody; added and
deleted keys rerun `Object.keys`/`in`/`for…in` readers and a reader of a
missing key; array `push`/`splice`/`reverse`/`length = 0`; one effect run
per update; writes through the view throw; store values assign as plain
objects; non-plain objects are not wrapped; a throwing update; draft reads
inside an enclosing derivation are untracked; a template text binding and a
keyed `each()` update from store writes and keep existing row nodes.
`each()` accepts `readonly` arrays (type-only change) so store arrays pass
directly.

## Consequences

- New entry `core-store` with its own budget (gzip 832 B, Brotli 768 B;
  measured 760 / 679). No existing entry changes size.
- Numbering: open PRs for SV2-003 and SV2-006 also propose ADR 0054; the
  first to merge keeps the number and the others renumber (the docs checker
  rejects gaps, so each PR takes the next free number on `main`).
