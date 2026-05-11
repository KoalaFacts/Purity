# 0038: Async-aware view transitions

**Status:** Accepted
**Date:** 2026-05-12

## Context

ADR [0017](./0017-view-transitions.md) shipped `manageNavTransitions()`
with an explicit non-feature carry-out:

> **Async route handlers** (a route view that depends on an unresolved
> `resource()`) aren't fully captured. The transition completes its
> snapshot the moment the synchronous reactive watchers finish; data
> arriving later updates the post-transition DOM normally. For
> transition-aware data loading wrap the route handler logic in your
> own `shouldTransition` predicate that defers until data is ready.

The `shouldTransition` workaround doesn't actually solve the problem
— it just gates whether the transition runs. There's no way for an
app to say "start the transition AND wait until the new route's data
has loaded before the browser samples the after-state."

The View Transitions API supports this natively: when
`startViewTransition`'s callback returns a `Promise`, the browser
holds the snapshot until the promise settles, then samples the
"after" state and animates. Purity's wrapper currently passes a
sync callback so this capability is unused.

Apps with loader-driven routes (ADR 0022 + ADR 0025) want this:
the new route's `loader()` returns a Promise; the transition should
hold until that data lands, then animate from the previous fully-
rendered page to the new fully-rendered page. Without the await, the
transition animates from page A to a "loading" version of page B
(empty containers, fallbacks), then page B fills in afterward — a
visible flash.

## Decision

**Add `awaitNavigation?: (url, replace) => unknown` to
`ManageNavTransitionsOptions`.** When supplied, the wrapper's
view-transition callback runs `update()` synchronously (URL signal
update + reactive watchers fire as before), then `await`s the user's
thunk before returning. The browser holds the snapshot for the full
duration of the await.

```ts
manageNavTransitions({
  awaitNavigation: async (url, replace) => {
    // App-specific signal that the new route's data is ready.
    await waitForRouteReady(url);
  },
});
```

Concretely:

- **Callback shape stays internal.** The wrapper picks a sync or
  async callback for `startViewTransition` based on whether
  `awaitNavigation` is set. No async-overhead penalty for apps that
  don't opt in.
- **`update()` always runs synchronously first.** The URL signal
  update happens before any await, matching the existing
  contract (route handlers see the new URL synchronously,
  `onNavigate` listeners fire synchronously). Apps reading
  `currentPath()` inside `awaitNavigation` see the new path.
- **Throwing or rejecting aborts the transition.** The promise
  returned by `startViewTransition` rejects; the browser cleans up
  the snapshot. **The URL update already happened** (it ran
  synchronously before the await), so the navigation is observable
  in `currentPath()` / history. This is the right behavior — apps
  shouldn't lose navigation state because a loader failed.
- **Sync return values are tolerated.** `awaitNavigation` is typed
  to return `unknown` so apps can synchronously return any value
  (or nothing). `await <non-promise>` is just the value; no error.
- **`shouldTransition: false` still short-circuits.** When the
  predicate rejects the transition, the wrapper falls through to
  the plain `update()` path — `awaitNavigation` isn't called and
  no snapshot is taken.
- **Reduced-motion still short-circuits.** Same path as
  `shouldTransition: false` — `awaitNavigation` isn't called when
  the user has requested reduced motion.

### Explicit non-features

- **Per-route awaitNavigation.** The hook is global — one thunk for
  every nav. Apps that want per-route awaits inspect `url` inside
  their thunk and decide what to await. Adding a per-route override
  is consistent with `shouldTransition`'s shape and is the obvious
  layer-up if a pattern emerges.
- **Default-on data awaiting.** The thunk has no default — apps
  must supply it. There's no framework-level "wait for all pending
  resources" because the framework doesn't own the consumer's data
  loading. Apps using ADR 0022's `loader` named export can use the
  manifest's `routes` + their own promise registry to implement
  this in user-land.
- **Snapshot timeout.** The View Transitions API has its own
  ~4-second internal timeout after which the snapshot is discarded
  and the transition aborts. We don't add a Purity-level timeout
  on top — let the platform handle it.
- **Cancel an in-flight transition on subsequent navigate.** If a
  user clicks two links in quick succession, the second wrapper
  call kicks off a second `startViewTransition`. The View
  Transitions API itself queues them; we don't add cancellation
  logic. Behavior matches every other shipping
  `startViewTransition` integration.

## Consequences

**Positive:**

- Closes the only ADR 0017 deferred non-feature that had a real
  pattern (async data-driven transitions). Apps with loader-driven
  routes can hold the snapshot until data lands, avoiding the
  flash-to-loading-state anti-pattern.
- The option is opt-in — zero overhead for apps that don't use it.
  The sync callback path stays sync, no async wrapper allocation.
- Composes with everything else: `shouldTransition` short-circuits
  before `awaitNavigation` runs, reduced-motion short-circuits,
  teardown cleans up identically.

**Negative:**

- One more option on `ManageNavTransitionsOptions`. Tree-shaking
  doesn't help here (the option is a flag inside the wrapper) but
  the cost is one extra `if` per nav.
- Apps must wire up their own "data ready" signal. The framework
  doesn't know when a route's data has settled — that's the
  consumer's responsibility. Users following the ADR 0022 pattern
  with `lazyResource` + `key` get a natural integration point
  (await the resource promise) but it's user-land glue.

**Neutral:**

- No new exports. `ManageNavTransitionsOptions` gains one field.
- The wrapper's branch on `awaitNavigation` is structural — TS
  picks the right callback shape per branch, no runtime check on
  the option inside the callback itself.

## Alternatives considered

**Make every wrapper callback async by default.** Always
`async () => { update(); }`. Rejected: imposes async overhead on
apps that don't need it. The current sync path stays sync.

**Add a separate `manageNavLoaderTransitions()` helper.** Two
helpers, one for sync, one for loader-aware. Rejected: doubles the
API surface for the same primitive. One option flag on the existing
helper is cleaner.

**Pass the pending-resource set as an argument to the thunk.**
Framework collects all `lazyResource().fetch()` promises across the
render and hands them to `awaitNavigation`. Rejected for now:
requires plumbing through the renderer + the resource registry. The
manual approach (apps maintain their own promise registry) covers
the same use case without coupling. Could be added later if a
common pattern emerges.

**Compose await + shouldTransition into one callback returning a
discriminated union.** `transition: (url, replace) => 'skip' | 'sync'
| Promise<void>`. Rejected: too clever, harder to read at call sites,
and the separation of "should it transition" from "how long should
the snapshot hold" is real.

## Test surface

`packages/core/tests/router-transitions.test.ts`:

- `awaitNavigation` is awaited inside the view-transition callback —
  the callback's returned promise doesn't settle until the user's
  thunk resolves.
- `url` + `replace` flag are passed through.
- Sync (non-Promise) return values are tolerated.
- A rejecting thunk lets the URL update land before the rejection
  propagates.
- `shouldTransition: false` short-circuits before `awaitNavigation`.
- Omitting `awaitNavigation` keeps the sync callback shape (no
  async wrapper allocation).
