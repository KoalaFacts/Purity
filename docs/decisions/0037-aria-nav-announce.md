# 0037: ARIA live-region announce on navigate

**Status:** Accepted
**Date:** 2026-05-12

## Context

ADR [0016](./0016-nav-focus-management.md) shipped `manageNavFocus()` —
move keyboard focus into the new page's landmark after every nav, so
AT vendors announce the focused element. ADR 0016 documented "ARIA
live region announce" as an explicit non-feature with this rationale:

> No ARIA live region — apps that prefer announcing route changes via
> a `<div aria-live="polite">` instead of moving focus can pass
> `{ onNavigate: (url) => liveRegion.textContent = url.pathname }`.
> Defaulting to focus-move matches the shipping ecosystem and works
> for both screen-reader and keyboard-only users.

The escape hatch (`onNavigate` callback) is correct but asks every app
that wants announce-only behavior to:

1. Create the live region in their HTML or imperatively;
2. Apply sr-only CSS so it doesn't disrupt layout;
3. Wire `aria-live` / `aria-atomic` / `role` attributes correctly;
4. Handle the same-text re-announce dance (most AT vendors only
   re-read when the text changes, so re-navigating to the same page
   silently does nothing).

That's a lot of accessibility detail to push to every consumer. The
patterns are well-established and stable; the helper is small enough
to ship as a first-class primitive.

There are two realistic deployment shapes:

- **Focus-move only** (the ADR 0016 default). Works for screen-reader
  users (focused element announces) and keyboard-only users (the
  caret visibly moves into the new region). Best for typical
  document-style pages.
- **Announce-only**. Don't move focus — that's disruptive for
  search-heavy UIs, kiosks where the user navigates with hardware
  keys, switch-access setups, and any UI that wants to keep the
  current focus (e.g. you're typing in a query and the page updates
  results). Write the route's name into a live region instead so AT
  vendors announce without changing focus.

Some apps want both: focus-move for major navigations, announce for
in-place updates (filter changes, pagination). The two helpers
compose cleanly — they can both subscribe to `onNavigate` and don't
fight each other.

## Decision

**Ship `manageNavAnnounce(options?)` in `@purityjs/core`.** Subscribes
to `onNavigate()` and writes the current page name into a polite
ARIA live region after every nav.

```ts
// entry.client.ts — announce-only
import { hydrate, interceptLinks, manageNavAnnounce, manageNavScroll } from '@purityjs/core';

hydrate(document.getElementById('app')!, App);
interceptLinks();
manageNavScroll();
manageNavAnnounce();
```

Concretely:

- **`manageNavAnnounce(options?: ManageNavAnnounceOptions): () => void`** —
  registers an announce handler. Returns a teardown. No-op on the
  server.
- **Default message** is `document.title` (read after a microtask,
  so `head()` / `manageTitle()` writes have flushed); falls back to
  `url.pathname` when title is empty or whitespace-only.
- **Default region** is created lazily on first navigate. Inline
  sr-only styles (`position:absolute; width:1px; height:1px; …
clip:rect(0,0,0,0)`) keep it out of the visual layout. Default
  id `'__purity_announce__'`.
- **`regionId` option** points at an existing element when the app
  ships its own region (with custom styles or placement). Existing
  elements are reused; the helper doesn't overwrite their
  `aria-live` / `role` attributes.
- **`live` option** picks `'polite'` (default) or `'assertive'`.
  Affects the auto-created region's `aria-live` value and pairs it
  with the conventional `role` (`'status'` for polite, `'alert'`
  for assertive). User-authored regions keep their own attributes.
- **`message` option** is the strongest customisation point —
  `(url, replace) => string`. Replaces the default title-lookup with
  whatever string the app wants to announce (e.g. localised page
  names, `"Loading users..."`, `"Page ${n} of ${total}"`).
- **`onNavigate` option** is the full escape hatch. Replaces the
  default handler entirely; the helper just subscribes the callback
  to `onNavigate` (with the microtask defer). `regionId` / `live` /
  `message` are all ignored when supplied.
- **Microtask defer** matches `manageNavFocus` / `manageNavScroll`
  so route-mounted DOM exists before the announce text is computed
  (specifically: `document.title` is whatever `manageTitle` wrote
  during this nav, not the stale previous-page title).
- **Same-text re-announce** — when the new message is identical to
  the existing `textContent`, clear it for one microtask and write
  it back. Most AT vendors only re-read on change; this is the
  documented workaround used across the ecosystem.

The new key on `configureNavigation()` is `announce` — same
true / false / options-object semantics as the other four. Off by
default (focus is the recommended baseline; announce is the
alternative posture).

### Explicit non-features

- **Removing the region on teardown.** The region stays in the DOM
  after `teardown()`. Apps that recreate the announce helper (HMR,
  spec runs) would otherwise repeatedly create + destroy DOM nodes;
  reuse is cheaper and the user-visible effect is zero (the region
  is sr-only).
- **Announce route data / loader payload.** The message function
  receives `(url, replace)`; apps that want richer announces wire
  their own logic. We don't want a framework-level "what to announce"
  policy.
- **Multi-region announce.** Some apps want both polite + assertive
  regions and split announces between them. That's a custom
  `onNavigate` handler. The default helper picks one region.
- **Combined focus + announce coordination.** Some patterns layer
  focus-move with a delayed announce (focus first, announce 300ms
  later if the user hasn't interacted). Out of scope. Compose
  `manageNavFocus()` + `manageNavAnnounce()` with custom callbacks
  for that level of orchestration.
- **`<title>` synchronisation.** Already shipped — ADR 0030's
  `manageTitle()`. Pairs with this helper out of the box (default
  message reads `document.title`).

## Consequences

**Positive:**

- Closes the announce-only accessibility gap that ADR 0016
  punted to "user-land via `onNavigate` callback". Apps that want
  the pattern no longer hand-roll the live region + sr-only CSS +
  same-text re-announce dance.
- Composes with `manageTitle()` (ADR 0030): apps using `manageTitle`
  get the page title announced automatically without writing any
  glue code.
- Composes with `manageNavFocus()` (ADR 0016) for apps that want
  both: focus moves visually + audio announce. Microtask defer
  ordering is identical so both see the same DOM state.
- New `announce` key on `configureNavigation()` keeps the
  one-call setup story coherent. Default `false` matches "announce
  is the alternative posture, focus is the recommended baseline".

**Negative:**

- One more opt-in primitive in `@purityjs/core`. The router surface
  now has five `manageNav*` helpers (scroll, focus, transitions,
  prefetch, announce). Apps using `configureNavigation()` see them
  as one consolidated option; standalone-import apps see a longer
  list. Tree-shaking is intact — unused helpers don't ship.
- The auto-created region is a DOM mutation outside the user's
  control. Inline sr-only style is visible in dev tools. Apps that
  want fully-controlled DOM use `regionId` pointing at their own
  element.

**Neutral:**

- Two new exports (`manageNavAnnounce`, `ManageNavAnnounceOptions`).
- The same-text re-announce path uses three microtasks (queue
  navigate callback → clear → restore). Negligible cost; happens
  only on identical-text re-navigates.

## Alternatives considered

**Default behavior: announce + focus together.** Both helpers always
run; users opt out individually. Rejected: too prescriptive. Some
apps actively don't want focus-move (kiosks, search-heavy UIs);
defaulting them on would surprise.

**Use `aria-live` on `<main>` directly instead of a separate region.**
Some patterns set `aria-live="polite"` on the page content itself.
Rejected: every route-driven DOM update would announce, including
reactive content the user didn't trigger. The dedicated region scopes
announces to nav events only.

**Read from `document.title` synchronously rather than after a
microtask.** Simpler timing model. Rejected: when paired with
`manageTitle()`, the title is set inside the reactive watch which
flushes after the current task. Reading sync would announce the
_previous_ page's title.

**Generate the announce string from route metadata rather than
`document.title`.** E.g. require an `<meta name="purity-announce">`
or look up a manifest entry. Rejected: framework-level coupling. The
`message` option already lets apps do this when they want it.

**Remove the auto-created region on teardown.** Symmetric with
create-on-first-use. Rejected: HMR cycles would thrash the DOM; the
sr-only region is invisible at rest so leaving it in place is the
right trade. Users who want symmetric semantics can call
`document.getElementById('__purity_announce__')?.remove()` in their
own teardown.

## Test surface

`packages/core/tests/router-announce.test.ts`:

- Region creation: default id, sr-only styles, polite + role="status";
  assertive + role="alert"; reuse existing element by id;
  lazy-on-first-navigate.
- Message text: announces `document.title` when set; falls back to
  `url.pathname` when title empty / whitespace-only; custom `message`;
  `replace` flag is passed through.
- Same-text re-announce: identical message triggers clear-then-set.
- Custom `onNavigate`: replaces default entirely, no auto-region.
- Teardown: stops announcing, leaves region in DOM.
- Server: no-op when `document` is undefined.

`packages/core/tests/router-configure.test.ts`:

- `announce: true` enables the helper.
- `announce: { … }` forwards options.
- Default is off (no region created without opt-in).
