# 0029: `prefetchManifestLinks()` — hover-prefetch route modules

**Status:** Accepted
**Date:** 2026-05-11

## Context

ADR [0013](./0013-link-interception.md) installs a global click
listener that converts same-origin `<a href>` clicks into
`navigate()` calls. ADRs [0019](./0019-file-system-routing.md) +
[0025](./0025-async-route-composer.md) wire those navigations
through `asyncRoute(entry, params)` — which fires
`entry.importFn()` (and the route's loader) at click time.

For a SPA that code-splits per route (the ADR 0019 default), the
first navigation to any not-yet-loaded route incurs an import
roundtrip: the user clicks, `lazyResource({ key })` fires the
fetcher, and the framework awaits a JS chunk download before
rendering. On slow networks (or mobile) the latency is visible.

The mainstream fix is **hover prefetch**: when the user's mouse
enters a link, kick off the route's module import in the background.
By the time the click fires (typically 100-300ms later), the chunk
is already cached and `asyncRoute`'s `importFn()` resolves
synchronously. The browser handles the network; the framework
doesn't add new dependencies.

This ADR ships `prefetchManifestLinks(routes, options?)` as a
sister to `interceptLinks`. It installs a delegated `mouseenter`
listener that matches the link against the manifest and calls
`entry.importFn()` to warm the cache. ADR 0027's
`configureNavigation` consolidator gains a `prefetch` option that
takes the manifest routes, wiring everything into one call.

## Decision

**Add `prefetchManifestLinks(routes, options?)` to `@purityjs/core`,
and a `prefetch?: { routes } | false` key to
`ConfigureNavigationOptions`.** The standalone helper installs a
global delegated `mouseenter` listener; the consolidator option
wires it into the canonical SPA boot sequence.

```ts
import { configureNavigation, prefetchManifestLinks } from '@purityjs/core';
import { routes } from 'purity:routes';

// Standalone:
prefetchManifestLinks(routes);

// Consolidated:
configureNavigation({ prefetch: { routes } });
```

When the user hovers a same-origin `<a href>` that matches a
manifest entry, the helper calls `entry.importFn()` (and every
`entry.layouts[].importFn()`) to warm the bundler's module cache.
By the time the user clicks, `asyncRoute`'s subsequent
`importFn()` call returns the cached promise immediately and
rendering proceeds without a network roundtrip.

Concretely:

- **`prefetchManifestLinks(routes, options?): () => void`** — takes
  the manifest's `routes` array (structurally typed — anything
  matching `AsyncRouteEntry` works). Returns a teardown.
- **`PrefetchManifestLinksOptions`** fields:
  - `delay?: number` — debounce ms between `mouseenter` and the
    actual prefetch fire. Default `50` ms — most accidental hovers
    (cursor crossing the link in transit) cancel before firing.
  - `shouldPrefetch?: (event, anchor) => boolean` — predicate
    that replaces the default filter (modifier keys / target /
    cross-origin / `data-no-prefetch`). Returning `false` skips.
  - `routes?` field on the consolidator: `false` skips prefetch
    setup; an object with `routes: ReadonlyArray<…>` enables it.
    `true` is not accepted — without `routes` there's nothing to
    prefetch against.
- **Match rule**: an anchor's `pathname` is matched against
  every `entry.pattern` via `matchRoute(pattern, pathname)`.
  First match wins. The pattern's params don't matter for
  prefetch — the import is keyed on the module, not the params.
- **Module-cache warming**: prefetch fires `entry.importFn()` and
  every `entry.layouts[].importFn()` in parallel via
  `Promise.all`. No await — fire-and-forget. Errors swallowed
  (`.catch(() => {})`); if the chunk fails to load, the user's
  click triggers the same failure and the consumer's error
  boundary handles it the usual way.
- **Default filter** (matches `interceptLinks`'s predicate set):
  - Modifier keys (cmd / ctrl / shift / alt) skip — user is about
    to open in a new tab.
  - `target` other than `_self` skips.
  - `download` attr skips.
  - Cross-origin skips.
  - `data-no-prefetch` attr skips.
  - Bare `#hash` hrefs skip (same-page anchor).
- **Per-link debounce**: the `mouseenter` handler schedules a
  setTimeout after `delay` ms; `mouseleave` cancels it. A hover
  shorter than `delay` doesn't fire.

### Explicit non-features

- **No loader prefetch.** Phase 1 prefetches only module imports
  (the JS chunks). Loaders run client-side at click time. Adding
  loader prefetch needs a client-side cache parallel to
  `ssrCtx.resolvedDataByKey`; that's a separate ADR with its own
  invalidation story.
- **No focus prefetch.** Tab-focusing a link doesn't fire prefetch
  in Phase 1. Reasonable for accessibility (keyboard users
  shouldn't pay the network cost of every focused link); apps
  that want focus prefetch supply a custom `shouldPrefetch`.
- **No visible-link prefetch.** IntersectionObserver-based
  prefetch (Astro pattern) fires when a link enters the viewport.
  Useful for static content but generates a flood of fetches on
  link-heavy pages. Apps that want it build it externally and
  call `entry.importFn()` themselves.
- **No prefetch on `mousedown` / `touchstart`** (early-press
  prefetch). Saves another 100ms on cold clicks but only marginally
  improves the hover-already-fired case. Adds complexity for low
  gain.
- **No automatic prefetch budget.** Hovering 20 links would fire
  20 prefetches. Browsers' connection pooling + bundler chunk
  dedup limit the damage in practice. Apps that want a strict
  budget supply `shouldPrefetch`.
- **No coordination with `interceptLinks`.** Both helpers add
  their own listeners. They don't conflict — `interceptLinks`
  handles `click`, `prefetchManifestLinks` handles `mouseenter`.
  No shared state.
- **No retry on prefetch failure.** Failed prefetches don't
  retry; the user's click re-fires the import via `asyncRoute` and
  surfaces the error the usual way.

## Consequences

**Positive:**

- Closes the deferred non-feature from ADRs 0013 + 0019. Slow-
  network UX improves substantially with one extra line.
- Composes with the existing manifest + `interceptLinks`. No new
  conventions; just an additional listener.
- Tree-shakable. Apps that don't call it pay zero bundle cost.
  `configureNavigation` callers opt in via the new key.
- The implementation is ~50 LOC. The delegated listener pattern
  matches `interceptLinks`; cancel-on-leave + debounce add a
  small bookkeeping `Map<HTMLAnchorElement, number>` for pending
  timers.

**Negative:**

- Prefetch fires speculatively. On a hover-and-leave the chunk
  was downloaded for nothing. Default debounce (50 ms) absorbs
  most accidental hovers; apps with aggressive UX raise the
  delay or supply a stricter predicate.
- No back-pressure. A user dragging across a link grid can
  trigger many prefetches in quick succession; browser
  connection limits eventually throttle. Documented; apps with
  link-dense pages can throttle via `shouldPrefetch`.
- Loader data still loads on click. The benefit caps at "JS
  ready" — apps doing heavy server-side data fetching still see
  the second roundtrip. Phase 2 ADR (loader-prefetch) would
  close this.

**Neutral:**

- Two new exports (`prefetchManifestLinks` +
  `PrefetchManifestLinksOptions`). One new key on
  `ConfigureNavigationOptions` (`prefetch`).
- Tests: unit test for the predicate (modifier keys, cross-origin,
  data-no-prefetch), integration test for the mouseenter →
  setTimeout → import-fire chain, teardown verification.

## Alternatives considered

**Add a `prefetch` boolean to `InterceptLinksOptions`.** Mash both
listeners into one helper. Rejected: `interceptLinks` is in core
and doesn't know about the manifest. Adding a manifest-aware
codepath inside it would either duplicate the matching logic or
force `interceptLinks` to import from a manifest module — both
worse than a separate helper.

**Use Link's native `<link rel="prefetch">` HTML element.** Insert
a `<link rel="prefetch" href="…">` per same-origin link on the
page. Browser-driven; survives without JS. Rejected: needs the
chunk URL (not the route URL), which the manifest's `importFn()`
doesn't expose. Could be added in a follow-up ADR alongside the
build-time route table emit (Path J).

**IntersectionObserver-based prefetch** (visible-link prefetch).
Astro's `data-astro-prefetch` pattern. Rejected for Phase 1: more
aggressive default, harder to throttle, and the hover case
covers the dominant UX win.

**Prefetch on `mousedown` instead of `mouseenter`.** Fires later
but with stronger signal (user is committing to the click).
Rejected: by then the click is ~50 ms away — too late to overlap
the network. `mouseenter` + 50 ms debounce wins on average.

**Make the helper take a `manifest` object (`{ routes,
notFound, notFoundChain }`) instead of just `routes`.** More
flexible. Rejected: prefetch only cares about route entries
(404s don't need prefetch — by definition the user is on an
unmatched URL). Trimming to `routes` matches the actual use.

**Auto-derive the matched entry on every hover** without caching.
Rejected: the lookup is O(routes) per hover. For small apps
fine; for large apps a `Map<string, entry>` keyed on the
literal-segment prefix would help. Add when needed.
