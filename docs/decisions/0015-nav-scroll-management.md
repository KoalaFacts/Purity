# 0015: Navigation scroll management

**Status:** Accepted
**Date:** 2026-05-10

## Context

ADR [0013](./0013-link-interception.md) shipped `interceptLinks()`
and explicitly punted on scroll restoration / focus management:

> **No focus management / scroll restoration.** A real router needs
> to handle scroll position on back-nav, focus on route change, and
> announce navigation to screen readers. Each is its own follow-up.

The most visible piece — scrolling to the top of the new page on
forward navigation — is the gap users notice first. Without it,
SPAs feel jarring: click a link mid-page, the URL changes, the
content updates, but the scroll position stays wherever the user
was on the previous page. Every production router (React Router,
SvelteKit, SolidStart) ships scroll-to-top by default.

Browser behavior covers two of the three cases for free:

- **Back / forward navigation** — `history.scrollRestoration` is
  `'auto'` by default; the browser restores the saved scroll
  position when popstate fires. Nothing for the framework to do.
- **Hash-only navigation** — `<a href="#x">` clicks fire
  `hashchange` and the browser scrolls to the anchor element
  natively. Again nothing for the framework.
- **Forward `pushState` navigation** — the browser DOES NOT scroll
  on pushState. SPAs need to scroll themselves. This is the gap.

The right shape, given the rest of the router design, is a small
opt-in primitive that subscribes to `navigate()` and scrolls
appropriately. It composes with `interceptLinks()` (which calls
`navigate()`) so the typical client entry is three lines:

```ts
hydrate(root, App);
interceptLinks();
manageNavScroll();
```

A general-purpose subscription hook is also useful here — apps may
want to do focus management, analytics, view transitions, or other
per-nav side effects without re-deriving "did the user just
navigate?" from the reactive URL signal. Exposing a public
`onNavigate(listener)` makes the scroll manager a tiny consumer
rather than a special case.

## Decision

**Add two primitives to `@purityjs/core`:**

1. **`onNavigate(listener): () => void`** — a public subscription
   hook fired synchronously after every programmatic `navigate()`
   call. Listeners receive `(url: URL, replace: boolean)`. Returns
   a teardown. Does NOT fire on browser-driven popstate /
   hashchange (the reactive URL accessors already re-fire for those
   sources; `onNavigate` is specifically about "did the framework
   route us forward?").

2. **`manageNavScroll(options?)`** — a thin consumer that registers
   an `onNavigate` listener and scrolls appropriately:
   - URL has a hash + the target element exists → `el.scrollIntoView()`
   - URL has a hash + the target doesn't exist → `window.scrollTo(0, 0)`
   - URL has no hash → `window.scrollTo(0, 0)`

   Scrolls are deferred a microtask so DOM updates triggered by the
   same `navigate()` (route handler re-render mounting the hash
   target) have a chance to land first. `options.onNavigate` fully
   replaces the default handler when you want custom behavior
   (smooth scroll, restore-from-storage, focus a `<main>` element,
   anything).

Both are no-ops on the server. Both return teardown functions for
HMR / tests.

```ts
// entry.client.ts
import { hydrate, interceptLinks, manageNavScroll } from '@purityjs/core';
import { App } from './app.ts';

hydrate(document.getElementById('app')!, App);
interceptLinks();
manageNavScroll();
```

### Explicit non-features

- **No scroll-position persistence across reload.** The Web Platform's
  built-in scroll restoration handles same-tab back/forward.
  Persisting scroll across full reloads (Phoenix LiveView style) is a
  larger feature; defer.
- **No focus management.** ADR 0013 mentioned this; still its own
  follow-up. Patterns vary (focus `<main>`, focus an announce
  region, integrate with `<title>` change for screen readers).
- **No view transitions API integration.** `document.startViewTransition`
  pairs with `navigate()` but needs its own design (which routes
  should transition, fallback for unsupported browsers, prefers-
  reduced-motion). Separate ADR.
- **No prefetching, no scroll-position-save-on-pushState.** Bigger
  features that change the navigation lifecycle; defer.
- **No `<a href="#x">` interception by `manageNavScroll`.**
  `interceptLinks()`'s default predicate skips hash-only same-page
  links so the browser scrolls natively. `manageNavScroll` doesn't
  re-implement that; it only handles `navigate()`-driven nav.

## Consequences

**Positive:**

- Three-line opt-in closes the visible UX gap. Apps without
  `interceptLinks` + `manageNavScroll` still work; apps with them
  get full-fidelity scroll handling.
- `onNavigate` is general: scroll, focus, analytics, custom
  transitions all subscribe to the same hook. The framework owns
  one event surface instead of five.
- Microtask deferral handles the common "I navigated to /page#section
  and that section is mounted in the page's template" case
  correctly. Without it, the hash target wouldn't exist yet when we
  tried to find it.

**Negative:**

- `onNavigate` is the second sub-public hook in the router (alongside
  `interceptLinks`'s teardown). The router module is getting a small
  zoo of opt-ins. Acceptable while each opt-in is genuinely useful;
  worth consolidating if more accrete.
- `navigate()` now iterates a listener Set on every call. For typical
  apps the Set has 1–2 entries (`manageNavScroll`, maybe an analytics
  hook); cost is negligible. Hot-loop callers should be aware.
- Custom `onNavigate` handlers replace the default scroll behavior
  entirely — same "replace, don't extend" semantic as
  `interceptLinks`'s `shouldIntercept`. Documented, deliberate.

**Neutral:**

- Three exports added (`onNavigate`, `manageNavScroll`,
  `ManageNavScrollOptions`). Tree-shakable when unused.
- The microtask deferral makes scroll timing observable as
  asynchronous in tests; users who want sync behavior call
  `window.scrollTo(0, 0)` directly from their `onNavigate` listener
  instead of using `manageNavScroll`.

## Alternatives considered

**Bake scroll handling into `navigate()` directly.** No opt-in,
just always scroll to top on forward nav. Rejected: framework would
make UX decisions that some apps want to override (smooth scroll,
preserve position for filter changes, transitions). Opt-in
primitive matches the rest of the router's contract.

**Monkey-patch `window.history.pushState` and `replaceState`.**
React Router-style. Catches direct History API calls outside
`navigate()`. Rejected: invasive global mutation, hard to test
clean teardown, and the framework's navigation contract is "use
`navigate()`." Users who call pushState directly opt out of
framework features intentionally.

**Use `IntersectionObserver` / `MutationObserver` to detect the
hash target appearing.** Handles "hash target mounts asynchronously
after navigate" without requiring queueMicrotask. Rejected:
substantially more complex; microtask deferral covers the typical
case where route handlers run synchronously in response to the
reactive URL signal.

**No `onNavigate` export — implement scroll directly inside
`router.ts` without a hook.** Rejected: locks future side-effect-on-
nav features (focus, transitions, analytics) into either growing
the router module or re-deriving via the URL signal. Public
`onNavigate` gives downstream features the right primitive.

**A `useRouteEvent` / `onRouteChange` that fires on all URL changes
(navigate + popstate + hashchange).** Convenient but redundant with
the reactive URL accessors — those already re-fire on every URL
change, and `watch(() => currentPath())` is the right way to react
to any nav. `onNavigate` is specifically for the "did the framework
route forward?" semantic, which back/forward doesn't share.
