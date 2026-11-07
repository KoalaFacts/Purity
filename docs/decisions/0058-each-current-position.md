# 0058: Current keyed position in each()

**Status:** Proposed (SV2-008; implementation slices tracked in
[the surpass-Solid ledger](../plans/surpass-solid.md))
**Date:** 2026-11-08

## Context

`each(list, mapFn, keyFn)` keeps a row's DOM and owner while its key stays in
the list, and updates the row's `item()` accessor in place. The renderer's
second argument is the index at which the row was created, so after a keyed
prepend, reverse or removal an ordinal label (`3.`) or a position-based action
(`removeAt(i)`) reads a stale number unless the whole row re-renders
([SV2-008](../solid-v2-gap-analysis.md#sv2-008)). Solid v2 (rc.20) `For`
gives keyed rows an index accessor that follows the row.

## Decision

`each()` passes a third renderer argument, `position: () => number`, the row's
current index in the source list. The existing arguments keep their meaning, so
no call site changes.

```ts
each(
  todos,
  (todo, _index, position) =>
    html`<li>
      ${() => `${position() + 1}.`} ${() => todo().title}
      <button @click=${() => removeAt(position())}>×</button>
    </li>`,
  (todo) => todo.id,
);
```

Contract (slice 1):

1. **Value.** `position()` is the item's index in the list passed to the
   latest reconcile (the source index: with a duplicate key, rows after it keep
   the source index, as the `index` argument already does).
2. **Reactivity.** It is a signal read: bindings that read it re-run when the
   row moves; bindings that do not are unaffected. The signal is created on the
   first `position()` read, so rows that never read it cost one number field.
   Read first after several reorders, it returns the current index.
3. **Identity.** A move updates the position without re-rendering the row:
   node references, focus and local input state are kept, on both the
   `moveBefore` path and the fragment fallback.
4. **Disposal.** A removed row's bindings are disposed once with the row and
   are not updated by later reconciles.
5. **SSR and hydration.** `eachSSR` passes `() => i`; rows adopted by
   hydration receive the same accessor and are updated by later reconciles.

Out of scope for slice 1: `list()` and `virtualEach()` (their renderers keep
two arguments) and a positional (non-keyed) mode with fixed slots, which
`each(list, mapFn, (_, i) => i)` already expresses.

## Consequences

- Ordinal labels and position-based callbacks stay correct after keyed
  reorders without re-rendering rows.
- Every reused row's `position` is written on each reconcile that changes the
  list (one number assignment, plus a signal write when the row reads it).
  Unchanged lists take the same-keys path, which already updates every row.
- `core` and `core-csr` grow by a few bytes within their existing budgets.

## Alternatives considered

- **Make the second argument an accessor** (Solid's shape). Breaks every
  existing call site that uses `index` as a number.
- **An `eachIndex()` function read from the current owner.** Needs an owner
  lookup that must skip nested component scopes, and is easy to call outside
  a row render by mistake.
- **Always create the position signal.** One extra signal per row for lists
  that never read it; the lazy accessor avoids that cost.
