# 0016: Navigation focus management

**Status:** Accepted
**Date:** 2026-05-10

## Context

ADR [0013](./0013-link-interception.md) and ADR
[0015](./0015-nav-scroll-management.md) both explicitly deferred focus
management as a follow-up:

> _ADR 0013:_ A real router needs to handle scroll position on
> back-nav, focus on route change, and announce navigation to screen
> readers. Each is its own follow-up.
>
> _ADR 0015:_ **No focus management.** ADR 0013 mentioned this; still
> its own follow-up. Patterns vary (focus `<main>`, focus an announce
> region, integrate with `<title>` change for screen readers).

The accessibility gap is real and well-documented. In traditional
multi-page apps, the browser fires a full document load and screen
readers announce the new page. In SPAs the document doesn't change;
the framework replaces content reactively but emits no event the AT
can hear. **Users on screen readers / keyboard-only / switch-access
get stuck on the previous page's interactive widget, with no signal
that the route changed.**

The shipping ecosystem has converged on a small pattern: move
keyboard focus into the new page's main landmark (or to a labeled
region) after navigation. NVDA, JAWS, VoiceOver all announce the
focused element's role + accessible name when focus lands on a
new region. Routes that need a richer announce can layer an
ARIA live region on top, but for the common case "focus `<main>`"
is the right default.

The integration shape is identical to ADR 0015 (`manageNavScroll`):
subscribe to `onNavigate()`, do the focus work in a microtask so
route-driven DOM updates flush first, pair with `preventScroll: true`
so it doesn't fight scroll restoration.

## Decision

**Ship `manageNavFocus(options?)` in `@purityjs/core`.** Subscribes
to `onNavigate()` and moves keyboard focus into the new page's
landmark element on every forward nav.

```ts
// entry.client.ts
import { hydrate, interceptLinks, manageNavFocus, manageNavScroll } from '@purityjs/core';

hydrate(document.getElementById('app')!, App);
interceptLinks();
manageNavScroll();
manageNavFocus();
```

Concretely:

- **`manageNavFocus(options?: ManageNavFocusOptions): () => void`** —
  registers a focus handler. Returns a teardown. No-op on the server.
- **Default behavior** mirrors `manageNavScroll`'s "hash target
  first" priority so focus and scroll target the same element:
  - URL has hash + element with that `id` exists → focus that element.
  - URL has no hash, OR the hash target is missing → focus the first
    element matching `selector` (default `'main'`).
- **`selector` option** — CSS selector for the fallback landmark.
  Defaults to `'main'`. Common overrides: `'h1'` (focus the
  heading), `'[role="region"][aria-label]'` (a labelled region),
  app-specific class.
- **`onNavigate` option** — replace the default handler entirely.
  Receives `(url, replace)` from {@link onNavigate}; do whatever
  focus / live-region announce / `<title>` integration work fits
  your app. When supplied, `selector` is ignored.
- **Tabindex handling.** Landmark elements (`<main>`, `<section>`,
  …) aren't focusable by default. The handler adds `tabindex="-1"`
  before calling `.focus()` when no tabindex is set, making the
  element programmatically focusable without injecting it into the
  keyboard tab order. **Existing tabindex values are preserved** —
  users opting their own element into the tab order keep their
  choice.
- **`preventScroll: true`** on the focus call so `manageNavScroll`'s
  scroll-to-top isn't undone by focus auto-scrolling the page back
  to the landmark.
- **Microtask defer.** Route handlers may mount the target landmark
  synchronously in response to the reactive URL signal, but the DOM
  flushes after the current task. Deferring gives the new landmark
  time to exist before lookup. Identical reasoning to
  `manageNavScroll`.

### Explicit non-features

- **No ARIA live region** — apps that prefer announcing route
  changes via an `<div aria-live="polite">` instead of moving focus
  can pass `{ onNavigate: (url) => liveRegion.textContent = url.pathname }`.
  Defaulting to focus-move matches the shipping ecosystem and
  works for both screen-reader and keyboard-only users.
- **No `<title>` synchronisation.** Combining `head()` for per-route
  `<title>` with `manageNavFocus` produces the right announce
  behavior (focus lands → AT reads the new accessible name; title
  becomes the new page in the tab bar). The framework doesn't
  prescribe how user code updates `<title>`.
- **No focus restoration on back-nav.** Browsers handle scroll
  restoration on back/forward natively; focus restoration is murkier
  and rarely what users want (focusing a stale interactive widget
  after back-nav is confusing). Apps that want it implement a
  custom `onNavigate` handler that reads `document.title` /
  history state.
- **No focus-trap inside route content.** Different scope —
  modal/dialog focus trapping is its own concern.

## Consequences

**Positive:**

- Closes the accessibility gap that ADR 0013 + 0015 both flagged.
  SPAs that pair `interceptLinks() + manageNavScroll() +
manageNavFocus()` now announce route changes to screen readers
  in the same way multi-page apps do.
- Hash-target priority matches `manageNavScroll` so the two
  primitives operate on the same element. No fight; coherent UX.
- `preventScroll: true` keeps focus from undoing scroll restoration.
- Custom `onNavigate` handler is the same shape as
  `manageNavScroll`'s — apps with bespoke focus / announce flows
  use one consistent extension point.

**Negative:**

- One more opt-in primitive (`manageNavFocus` joins `interceptLinks` +
  `manageNavScroll` + `onNavigate`). The router module's surface is
  growing; future ADRs should think hard about whether yet another
  `manageNav*` is the right shape or if a single
  `configureNavigation({ scroll, focus, … })` would consolidate
  better. Phase 1 prefers individual primitives so each is
  tree-shakable.
- Adding `tabindex="-1"` mutates the user's DOM. The attribute is
  visible in dev tools but harmless; documented in the docstring.
  Custom selectors that target focusable elements (`<h1>` with
  `tabindex="0"`) bypass the mutation entirely.
- Default selector `'main'` doesn't handle pages with multiple
  `<main>` elements (rare per the HTML spec — one landmark per
  page) or pages with no `<main>` at all (no-op). Custom selector
  covers both cases.

**Neutral:**

- Two exports added (`manageNavFocus`, `ManageNavFocusOptions`).
  Tree-shaken when unused.
- Microtask deferral makes focus timing observable as asynchronous
  in tests; users who want sync behavior call `el.focus()` directly
  from their custom `onNavigate`.

## Alternatives considered

**Move focus inside `navigate()` itself.** Always focus, no opt-in.
Rejected: framework would make a11y decisions for apps that have
their own custom focus management (modal-heavy apps, kiosks with
hardware focus). Opt-in primitive matches the rest of the router's
contract.

**ARIA live region instead of focus.** A `<div aria-live="polite">`
that the framework writes route names into is one common pattern.
Rejected as the default because it doesn't help keyboard-only users
who aren't running an AT, and the right text to announce varies per
app (URL pathname? document.title? a custom announce string?).
Apps wanting this layer it via `onNavigate`.

**Focus `<h1>` by default.** Some routers default to the page
heading. Rejected: `<h1>` content may be reactive-text or absent on
some routes. `<main>` is structurally guaranteed on
properly-marked-up pages and works as the screen-reader landmark
without depending on text content.

**Auto-set `tabindex="-1"` permanently.** Some routers leave the
tabindex in place after the focus call. Rejected because that's the
current behavior — once added, it stays. Removing it on blur was
considered but adds DOM listeners + complexity for no observed
benefit (`tabindex="-1"` is harmless at rest).

**Bake focus into the SSR side via `<main autofocus>` markup
generation.** `autofocus` only fires on initial page load, not on
SPA navigation. Wrong shape for this problem.

**Fold focus + scroll into a single `manageNavigation({ focus,
scroll })` primitive.** Consolidation is cleaner from one angle
(single import, single teardown) but uglier from the
tree-shaking angle (the unused half ships with the used half). The
current per-concern primitives match `interceptLinks` and let
apps pick exactly what they need.
