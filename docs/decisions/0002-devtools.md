# 0002: Devtools approach

**Status:** Proposed
**Date:** 2026-05-09

## Context

Signal-based reactivity is hard to debug without tooling. When a UI
"glitches" — wrong value, missing update, infinite loop — there is no
visible call stack, no visible component tree, no visible dataflow.
The framework today exposes its graph only through `console.log` and a
careful read of `packages/core/src/signals.ts`.

Three forces:

1. **The graph is already inspectable.** Every `state` / `compute` /
   `watch` node in `signals.ts` has a `version` field that bumps on
   change and a `status` field (CLEAN / CHECK / DIRTY) that tracks
   propagation state. A devtools panel could read these directly with
   minimal new code in the framework.

2. **Browser-extension complexity.** A real Chrome devtools panel is
   ~200–500 LOC of MV3 plumbing (background script, content script,
   panel iframe, message passing) before you render a single row of
   data. Multiplied across Chrome / Firefox / Safari, this is a
   project of its own.

3. **User pull is uncertain.** Pre-1.0, there are zero known
   production users. We don't know which signal-graph views are
   actually useful in real apps. Building speculatively risks shipping
   the wrong panel.

## Decision

**For 1.0: no devtools.** Document the existing inspection patterns
(read `version`, `status`, `sources`, `observers` from any node via
the browser console) in a `docs/debugging.md` page. Ship a small
`__purity_inspect__` global hook on `globalThis` so the framework's
reactive graph is reachable without source-tree spelunking.

**Final `__purity_inspect__` shape** (as pinned in the implementation):

```ts
interface InspectorNode {
  kind: 'state' | 'computed' | 'effect';
  version: number;
  status?: 'clean' | 'check' | 'dirty'; // present on computed and effect, not state
  value: unknown;
  sources: InspectorNode[]; // empty for state
  observers: InspectorNode[];
}

declare global {
  // eslint-disable-next-line no-var
  var __purity_inspect__: {
    version: 1; // breaking-change counter for the inspector itself
    nodes(): InspectorNode[]; // every state/computed/effect not GC'd yet
  };
}
```

The `version: 1` field on the hook itself is the first thing a
devtools panel checks, so we can evolve the shape later without
silently breaking older panels. The graph view exposed by `nodes()`
is a snapshot — each call rebuilds it. Cycles are preserved by
reference identity within a single call (the same `InspectorNode`
object appears at both ends of an A→B→A path).

**Always-on, not dev-only.** The original plan was to gate the hook
on `process.env.NODE_ENV !== 'production'`. In practice Vite's lib
build substitutes the value at framework-build time, which would
strip the hook for everyone. Keeping the hook always present costs
~0.4 kB gzipped of code in the shared chunk and lets users debug
production deployments. Users who must remove it can do so via
their bundler's `define` (replace `globalThis.__purity_inspect__`
with `undefined`) or by stubbing the module post-import.

**Post-1.0 trigger:** revisit when several of the following are
true. The numbers below are judgment, not derived — adjust when the
moment comes:

- An open issue with sustained interest asking for a panel.
- A first production user with a non-trivial app.
- A volunteer maintainer for the panel itself.
- A clear use case the `__purity_inspect__` hook can't address (e.g.
  visual graph layout, time-travel, frame-by-frame timeline).

When the trigger fires, the recommended shape is **a Chrome MV3
extension** that reads `window.__purity_inspect__` over the existing
reactive graph. Reasons over a built-in in-page panel:

- No cost to non-developer bundles.
- Cross-app: one extension works for any Purity site.
- Standard devtools UX: docks to the existing browser devtools panels.

## Consequences

**Positive:**

- 1.0 ships without a 200+ LOC project gating it.
- The framework gains one (1) tiny dev-only export
  (`__purity_inspect__`) — a stable seam for future tooling without
  committing to the tooling itself.
- A documented debugging page closes a real gap with minimal effort.

**Negative:**

- Debugging stays harder than React/Vue/Solid — all of which have
  mature panels. This is a recognized competitive weakness, not a
  feature.
- Without time-travel/replay, race conditions in `resource()` and
  effects-cascading-through-`watch` chains are hard to diagnose.

**Neutral:**

- The `version` / `status` fields on graph nodes are already public
  (in source). Exposing them via `__purity_inspect__` doesn't widen
  the API surface — it just gives a stable, documented lookup path.

## Alternatives considered

- **In-page panel (renders into a corner of the host page).** Rejected:
  contaminates production builds (or requires a second build mode), no
  dock UX, no extension-store visibility. Used by some smaller
  frameworks, but the dev-experience ceiling is low.

- **Build the Chrome extension now, pre-1.0.** Rejected on cost and
  uncertainty: we don't know which views are useful and have no users
  to ask. Building blindly produces shelfware.

- **Adopt an existing devtools framework (React Devtools shape, Solid
  Devtools port).** Rejected: those tools are tightly coupled to their
  parent framework's data model. Porting is more work than building
  fresh against `__purity_inspect__`.

- **Do nothing.** Rejected: leaves users with no inspection story,
  which fails the same first-impressions test as no SSR. The hook +
  docs combination is the smallest credible answer.
