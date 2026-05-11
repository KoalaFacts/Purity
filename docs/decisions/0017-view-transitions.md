# 0017: View Transitions API integration

**Status:** Accepted
**Date:** 2026-05-10

## Context

ADRs [0013](./0013-link-interception.md), [0015](./0015-nav-scroll-management.md),
and [0016](./0016-nav-focus-management.md) all named view-transition
integration as a deferred follow-up:

> _ADR 0013:_ **No view transitions API integration.**
> `document.startViewTransition` pairs nicely with this primitive but
> is a separate ADR.
>
> _ADR 0015:_ **No view transitions API integration.**
> `document.startViewTransition` pairs with `navigate()` but needs
> its own design (which routes should transition, fallback for
> unsupported browsers, prefers-reduced-motion). Separate ADR.

The View Transitions API is the right native primitive for animating
between page states in an SPA. It snapshots the current DOM, runs a
mutation callback, snapshots the new DOM, and cross-fades between
them — with per-element morphing if the user marks pairs of elements
with the same `view-transition-name` CSS property. Style is
controlled entirely from CSS via the `::view-transition-*` pseudo-
element tree.

The integration shape that wasn't obvious before but is now:
`navigate()` is the right hook point, but it needs a wrapper hook
exposed to the user. `manageNav*` primitives already established
the per-concern "subscribe + run after navigate" pattern; view
transitions need the inverse — wrap the navigate so the snapshot
captures the BEFORE state, then trigger the URL update inside the
callback so the synchronous reactive watchers' DOM mutations land
before the snapshot captures the AFTER state.

A new "navigate wrapper" slot on the router fits cleanly: there's
exactly one wrapper per app (multiple would be ambiguous about
ordering), it composes naturally with the existing `onNavigate`
listeners (which fire inside the wrapper's `update()` callback),
and it's invisible to apps that don't opt in.

## Decision

**Add `manageNavTransitions(options?)` to `@purityjs/core`.**
Subscribes a wrapper that calls `document.startViewTransition()`
on every `navigate()` (when the API is supported and the user
hasn't requested reduced motion). The wrapper's callback runs the
URL signal update + reactive watchers synchronously; by the time
the callback returns, the new DOM state is in place and the
transition can cross-fade.

```ts
// entry.client.ts
import {
  hydrate,
  interceptLinks,
  manageNavScroll,
  manageNavFocus,
  manageNavTransitions,
} from '@purityjs/core';

hydrate(document.getElementById('app')!, App);
interceptLinks();
manageNavScroll();
manageNavFocus();
manageNavTransitions();
```

Concretely:

- **`manageNavTransitions(options?: { shouldTransition? }): () => void`** —
  registers a navigate wrapper. Returns a teardown. No-op on the
  server, no-op when `document.startViewTransition` is missing
  (Safari < 18, all Firefox as of 2026-05) — `navigate()` runs
  unwrapped in those browsers.
- **`shouldTransition` predicate** lets callers opt out per-nav
  (e.g. skip transitions for tab swaps inside the same page,
  enable them only for full-route changes). When unsupplied,
  every navigation transitions if the API is available.
- **`prefers-reduced-motion: reduce`** is honored automatically.
  When the user requested reduced motion, the wrapper bypasses
  `startViewTransition` and runs `update()` directly. Saves both
  motion sensitivity and the CPU cost of the snapshot.
- **Internal: `_setNavigateWrapper(fn)` slot on `router.ts`.**
  Single-slot (last setter wins). Underscore-prefixed export so
  apps with bespoke needs can use it but it's marked as opt-in.
  `manageNavTransitions` is the recommended consumer.
- **Synchronous callback.** The transition's callback calls the
  framework's `update()` which (a) updates `history.pushState`,
  (b) writes the URL signal, (c) fires `onNavigate` listeners.
  Reactive watchers fire synchronously inside (b); their DOM
  mutations land before the callback returns. Async route
  handlers (a route view that depends on an unresolved
  `resource()`) aren't fully captured — see "Negative" below.
- **Composition with `manageNavScroll` / `manageNavFocus`.** Both
  defer their work to a microtask via `queueMicrotask` (per ADR
  0015 / 0016), which lands inside the transition's "after"
  snapshot. Scroll + focus are part of the captured end state.

### Explicit non-features

- **No transition styling helpers.** Style is CSS, not framework
  code. Apps add `::view-transition-old(*)` / `::view-transition-
new(*)` rules and `view-transition-name` properties on their
  elements; the framework just calls the API.
- **No async-aware transitions.** Returning a Promise from the
  callback to await async work (per the View Transitions spec)
  isn't done — the framework doesn't know when the route's data
  has settled. Apps wanting transition-await semantics use a
  custom `shouldTransition` that defers nav until data is ready,
  or extend by setting their own wrapper via `_setNavigateWrapper`.
- **No view-transition types / per-route transition variants.**
  Browsers' [View Transitions Level 2 spec](https://drafts.csswg.org/css-view-transitions-2/)
  adds `viewTransition.types` for tagging transitions to style
  differently. Defer until the API is more widely shipped.
- **No back/forward integration.** Browser-driven popstate
  doesn't go through `navigate()` so the wrapper doesn't fire.
  Apps wanting back/forward transitions need their own
  popstate listener that wraps via `_setNavigateWrapper` semantics
  (or a future addition that exposes a parallel popstate hook).
- **No transition cancellation.** Rapid double-click navigations
  produce overlapping transitions today; the second's snapshot
  captures the first's interpolated state. Browsers handle this
  reasonably; the framework doesn't try to be smarter.

## Consequences

**Positive:**

- One opt-in line gives apps native cross-fade transitions on
  forward navigation. Per-element morphs work via the standard
  `view-transition-name` CSS property — no framework-specific
  wrapper.
- Honors `prefers-reduced-motion` automatically. Users with motion
  sensitivity get unwrapped navigation; everyone else gets the
  fade. Default-good a11y.
- Capability detection means apps don't write their own
  `if ('startViewTransition' in document)` branch — calling
  `manageNavTransitions()` from the entry is safe regardless of
  browser support.
- Composes cleanly with `manageNavScroll` / `manageNavFocus`. All
  three layer on the same `navigate()` lifecycle without fighting.

**Negative:**

- One more opt-in primitive (the fourth `manageNav*`). The router
  module's surface is well past the consolidation threshold ADR
  0016 mentioned. Worth a future rationalization pass — maybe a
  single `configureNavigation({ scroll, focus, transitions, … })`
  helper. Phase 1 keeps the per-concern primitives so each is
  individually tree-shakable.
- Async route handlers are a known limitation. Routes that
  fetch-then-render produce a transition that captures the
  loading state as the "after" snapshot, then animate normally
  again when data arrives. Documented; richer support is a
  follow-up that needs design (return-Promise from callback,
  intermediate fallback states, etc.).
- Single-slot wrapper means apps can install one wrapper at a
  time. Composable wrappers would be cleaner but the only
  realistic consumer pair (transitions + something custom) can
  be expressed by writing a custom wrapper that calls
  `startViewTransition` itself.
- The wrapper hook is underscore-exported (`_setNavigateWrapper`).
  Apps using it accept a not-yet-stable API contract. Documented.

**Neutral:**

- Two exports added (`manageNavTransitions`,
  `ManageNavTransitionsOptions`). Tree-shaken when unused.
- Internal hook (`_setNavigateWrapper`, `NavigateWrapper`) is
  exported but underscored to signal "opt-in / shape may change."
- The example client entry now has five lines of `manage*` opt-ins
  in a row. A `wireNavigation()` convenience that calls all four
  is tempting but commits to a "this is the right combination"
  default; the per-call opt-in keeps each visible.

## Alternatives considered

**Bake transitions into `navigate()` directly.** Always wrap when
the API is available. Rejected: framework would make UX decisions
that some apps want to override (animation duration, per-route
opt-out, custom styles). Opt-in primitive matches the rest of the
router's contract.

**Multi-slot wrapper / wrapper-list with explicit ordering.**
Allow multiple wrappers to compose. Rejected for Phase 1: ordering
ambiguity, and the realistic consumer pattern is "transitions" or
"something custom" — not both at once. Apps wanting both write a
combined wrapper themselves via `_setNavigateWrapper`.

**Use `onNavigate` listener instead of a wrapper.** ADR 0015's
`onNavigate` fires AFTER the URL update, which is too late — the
View Transitions API needs to capture the BEFORE state before any
DOM changes. A wrapper around the update is the right shape.

**Return a Promise from the wrapper callback to await async route
data.** Could let the transition cover loading states. Rejected
for Phase 1: the framework doesn't know when the route's
`resource()` calls have settled (multi-pass loop is a server-side
concept; client-side settling is per-resource). Apps wanting
transition-await build it themselves via custom wrapper.

**Auto-install when `manageNavScroll` / `manageNavFocus` are
called.** Removes the explicit call. Rejected — same reasoning as
ADR 0013's auto-install rejection: side-effect imports are an
anti-pattern; one explicit call per concern keeps the entry
readable.

**Make transitions work on browser back/forward via popstate
hook.** Useful but adds complexity (popstate doesn't have a
"target" the way navigate() does; the after-snapshot isn't
predictable until the framework reacts). Defer.
