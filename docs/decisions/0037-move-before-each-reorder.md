# 0037: Use `moveBefore` in `each()` reorder for state-preserving keyed list updates

**Status:** Proposed
**Date:** 2026-05-27

## Context

`each()`'s LIS-based reordering uses `Element.insertBefore` to relocate
keyed rows. `insertBefore` is structurally correct — rows end up in the
right place and the node references survive — but it is a _removal +
re-insertion_ under the hood. For rows whose root is a Purity custom
element, this triggers `disconnectedCallback` → `connectedCallback`,
which tears down the component's `_ctx`, re-fires `onMount`, and
re-renders the shadow tree. State that should be visually stable
across a reorder is lost:

- Focus inside a row (an `<input>` cursor jumps out)
- CSS transitions / animations restart from frame 0
- An `<iframe>`'s load state is lost — content reloads
- A `<video>` resumes from time 0 (or reloads its source)
- A `<dialog>`'s modal state, a popover's open state, and pointer
  capture all reset

The platform now has a fix: `Element.moveBefore(node, ref)` performs a
true move — it preserves all of the above, and dispatches the new
`connectedMoveCallback` lifecycle hook _instead of_ the
disconnect+connect pair.

Browser status (May 2026):

- Chrome / Edge 133+ (Feb 2025)
- Firefox 144+ (shipped late 2025)
- Safari: positive standards-position but not yet shipped
- Global coverage: ~71% (caniuse)

`moveBefore` is a strict refinement: same correctness guarantees as
`insertBefore`, plus the preservation properties on supporting engines.
It throws (`HierarchyRequestError` / `NotFoundError`) under several
preconditions, the relevant ones here being:

- `node` must already be a child of `parent`. (Brand new rows aren't.)
- `ref` must be a child of `parent` (or `null` for "append").

Custom Elements need to opt in: a class with no `connectedMoveCallback`
defined falls back to disconnect+connect even under `moveBefore`. So
PurityElement must define the method (empty body is enough).

## Decision

We add `connectedMoveCallback() {}` to PurityElement, detect
`moveBefore` once at module init (`hasMoveBefore`), and introduce a
`moveOrInsert(parent, node, ref)` helper that prefers `moveBefore`
when both are true:

1. `hasMoveBefore` is true.
2. `node.parentNode === parent` (precondition for `moveBefore`).

Else falls back to `parent.insertBefore(node, ref)`. Any throw from
`moveBefore` also falls through to `insertBefore` — correctness wins
over preservation.

Two reorder sites in `control.ts` switch to `moveOrInsert`:

- **2-swap fast path**: when exactly two rows have swapped positions,
  the existing marker-based 3-op dance keeps its marker `insertBefore`
  and switches the other two operations to `moveOrInsert`. State is
  preserved on both swapped rows when `hasMoveBefore` is true.

- **LIS reorder**: the existing path accumulates moves into a
  `DocumentFragment` and flushes them in one `insertBefore`. The
  fragment optimization is incompatible with `moveBefore` (a fragment
  detaches its children from their original parent, breaking the
  `node.parentNode === parent` precondition). So we split:
  - `hasMoveBefore = true` → per-row `moveOrInsert`, no fragment.
  - `hasMoveBefore = false` → existing fragment-batching path
    unchanged.

The fragment-batching path is preserved for engines without
`moveBefore` because batching reduces layout thrash from many
sequential `insertBefore` calls. With `moveBefore`, the platform is
the one doing the move — there's no equivalent thrash to batch
against.

`connectedMoveCallback` is intentionally a no-op. Its job is purely
to signal "this element supports being moved." User-level `onMount`
/ `onDestroy` are _not_ re-fired by a move — that's the whole point.

## Consequences

**State preservation on supporting engines** (Chrome 133+, Firefox 144+):

- Focus inside a row survives reorder.
- CSS transitions and animations continue without restart.
- `<iframe>` doesn't reload.
- Popover, dialog, fullscreen states survive.
- Pointer capture survives.

**Correctness unchanged on Safari and older engines.** The fallback
path is byte-identical to the pre-ADR behavior.

**API surface unchanged.** No new exports. `connectedMoveCallback` is
internal — the framework's `onMount` / `onDestroy` contract stays the
same on every engine.

**`hasMoveBefore` is captured once at module load.** Test environments
that polyfill `moveBefore` after loading the framework see no effect.
For jsdom (no `moveBefore`), the fallback path runs in CI and the
moveBefore-path is verified by browser web-platform-tests at the
platform level.

**Behavioral note for users**: components are no longer rebuilt across
reorder on supporting engines. Any user code that relied on
`onMount` re-firing during reorder (e.g. "rebuild a chart when this
row moves") will silently stop running on those engines. That code
was already fragile — it depended on a teardown that the platform
didn't promise. Documentation will state explicitly: lifecycle hooks
fire on insertion and removal, not on reorder.

**LIS path branch cost**: one boolean check per reorder. Negligible.

**Bundle size**: net +~15 lines (the new fallback branch is preserved
as-is; the new moveBefore branch is shorter than the fallback).

## Alternatives considered

- **Always use `moveBefore` with a runtime try/catch**: works on
  supporting engines, but on Safari every call would throw, fall
  through to `insertBefore`, and incur exception overhead per move
  in a hot path. Module-init detection avoids that.

- **Detect on every call instead of once at module load**: same
  output, slightly more cost. Not worth optimizing for hot-swapping
  the API (the only realistic scenario is tests, where the
  setup-once approach is fine).

- **Use `moveBefore` for all DOM mutations in the framework, not
  just `each()` reorder**: tempting but `moveBefore` is only useful
  when moving _already-mounted_ nodes. Most framework DOM ops are
  fresh inserts or initial mounts — `insertBefore` is the right
  semantic there. The reorder path is the unambiguous win.

- **Wait for Safari**: Safari has signaled positive intent but no
  ship date. The benefit is too large on the two major Chromium /
  Gecko surfaces to delay; the Safari fallback is byte-identical
  to today's behavior.

- **Expose `connectedMoveCallback` as a public hook (e.g.
  `onConnectedMove`)**: deferred. The platform semantic is "do
  nothing extra during a move"; surfacing it as a hook implies
  it's meant to run user code, which goes against the design.
  Can be revisited if a clear use case emerges.

## Testing

jsdom doesn't expose `moveBefore`, so CI always runs the
`insertBefore` fallback. Tests verify:

- `PurityElement.prototype.connectedMoveCallback` exists (opt-in).
- The fallback path produces correct DOM after reverse, 2-swap,
  and rotate operations.
- Node references are preserved across reorder.

Real-browser behavior of `moveBefore` (focus retention, animation
state, iframe state) is covered by web-platform-tests at the
platform level.

## References

- [MDN — Element.moveBefore](https://developer.mozilla.org/en-US/docs/Web/API/Element/moveBefore)
- [MDN — connectedMoveCallback](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_custom_elements)
- [Chrome — Preserve state during DOM mutations with moveBefore (Feb 2025)](https://developer.chrome.com/blog/movebefore-api)
- [Mozilla standards-positions #1053](https://github.com/mozilla/standards-positions/issues/1053)
