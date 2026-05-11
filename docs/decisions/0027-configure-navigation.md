# 0027: `configureNavigation()` — single setup for the four `manageNav*` opt-ins

**Status:** Accepted
**Date:** 2026-05-11

## Context

ADRs [0013](./0013-link-interception.md) + [0015](./0015-nav-scroll-management.md)

- [0016](./0016-nav-focus-management.md) + [0017](./0017-view-transitions.md)
  each ship a small opt-in navigation helper:

```ts
// examples/ssr/src/entry.client.ts (before this ADR)
import {
  hydrate,
  interceptLinks,
  manageNavFocus,
  manageNavScroll,
  manageNavTransitions,
} from '@purityjs/core';

hydrate(root, App);
interceptLinks();
manageNavScroll();
manageNavFocus();
manageNavTransitions();
```

Every Purity SPA with a router runs all four — they're complementary,
not alternatives. The four-line setup block is recurring boilerplate
that recurs verbatim across apps. ADR 0017's deferred-non-features
list called this out:

> `configureNavigation({ scroll, focus, transitions, … })`
> consolidation (ADR 0017 non-feature) — single setup helper for the
> four `manageNav*` opt-ins.

This ADR ships that. The individual helpers stay (apps that want only
one keep their fine-grained import). The new function bundles all
four into one call with per-helper opt-out + per-helper options.

## Decision

**Add `configureNavigation(options?)` to `@purityjs/core`.** Calls
`interceptLinks` + `manageNavScroll` + `manageNavFocus` +
`manageNavTransitions` in that order, enabling each by default.
Per-helper opt-out + per-helper options are accepted under named
keys.

```ts
import { configureNavigation, hydrate } from '@purityjs/core';

hydrate(root, App);
configureNavigation(); // all four, default options
```

Per-helper overrides:

```ts
configureNavigation({
  intercept: { exclude: 'a[data-no-intercept]' }, // pass-through options
  scroll: false, // disable this one
  focus: { selector: 'main, [role=main]' }, // pass-through
  transitions: true, // explicit on (same as default)
});
```

Concretely:

- **`ConfigureNavigationOptions`** — an object with four keys, each
  optional:
  - `intercept?: InterceptLinksOptions | boolean`
  - `scroll?: ManageNavScrollOptions | boolean`
  - `focus?: ManageNavFocusOptions | boolean`
  - `transitions?: ManageNavTransitionsOptions | boolean`
- **Per-helper semantics**:
  - **Omitted** — helper runs with its default options.
  - **`true`** — same as omitted (explicit "on").
  - **`false`** — helper is skipped entirely.
  - **Options object** — helper runs with the supplied options.
- **Call order** matches the existing canonical sequence in
  `examples/ssr/src/entry.client.ts`: intercept → scroll → focus →
  transitions. Apps that want a different order keep calling the
  individual helpers themselves.
- **Idempotency** — `configureNavigation` is a one-shot setup. The
  underlying helpers each install global listeners / wrappers that
  shouldn't be installed twice. Calling `configureNavigation` twice
  in the same session double-registers the listeners — same as
  calling `manageNavScroll()` twice. Not enforced.
- **Return value** — `void`. The individual helpers don't return
  teardowns either; navigation lifecycles outlive the page.

### Explicit non-features

- **No new functionality.** The helper composes existing functions
  one-for-one. No new behavior is exposed; the four ADRs continue
  to ship the actual logic.
- **No teardown.** Like `interceptLinks` / `manageNav*`, the setup
  is one-way for the page lifetime. Tearing down navigation
  listeners isn't something Phase-1 SPAs need.
- **No deprecation of the individual helpers.** Apps that want only
  one helper (e.g. just `interceptLinks` for a multi-page app
  that doesn't need view transitions) import the named one. Apps
  that want all four pick `configureNavigation`.
- **No fifth slot for future helpers.** If a future ADR adds a
  fifth `manageNav*` helper, the consolidator grows a key in a
  separate ADR. Adding a key here without a ship-or-not decision
  is over-design.
- **No reactive on/off.** The options are read once at call time.
  Apps that want to toggle, say, transitions based on a user
  preference call `manageNavTransitions` themselves with a
  conditional predicate via the helper's existing options.

## Consequences

**Positive:**

- Closes the "four-line boilerplate" pattern. Apps that want the
  standard router UX get one line.
- Composes with hydrate: `hydrate(root, App); configureNavigation();`
  is now the canonical SPA boot sequence.
- Tree-shakable: the helper imports the four named helpers
  directly; apps that don't call it don't pull in the bundle.
- Zero behavior change. The helpers are called identically; tests
  for the four ADRs continue to cover the runtime semantics.

**Negative:**

- Slight API duplication. Apps now have two ways to install scroll
  management — explicit `manageNavScroll()` or
  `configureNavigation({ scroll: { …} })`. Apps will diverge on
  which they pick. Both work; the recommendation in docs goes to
  the consolidator.
- The default-all-on semantics differ slightly from the individual
  helpers (which require an explicit call). Documented: passing an
  empty options object means "all on" via the consolidator.

**Neutral:**

- One new export (`configureNavigation`) and one new type
  (`ConfigureNavigationOptions`). Tree-shakes when unused.
- The example's `entry.client.ts` migrates as a worked demo.
  Drops four import names + four call sites in favor of one.

## Alternatives considered

**A `purity({ … })` boot helper that wraps `hydrate` + the navigation
setup.** One-line app boot. Rejected: couples hydration to navigation
setup; multi-page apps that hydrate without an SPA router still
want the function. Two functions, one for each concern, is right.

**Default everything off** (require each key to be explicitly `true`
or an object to enable). Symmetric with the individual helpers'
opt-in pattern. Rejected: defeats the consolidator's purpose —
the whole point is to ship the canonical four-in-one block
without re-typing four enabling tokens.

**Take a positional array** (`configureNavigation([
'intercept', 'scroll', 'focus', 'transitions'])`). Strings instead
of an options object. Rejected: harder to pass per-helper options;
less discoverable.

**Make `configureNavigation` return an object with per-helper
disable handles** (so apps can selectively turn off later).
Rejected: the underlying helpers don't return disables. Adding
a return shape here without backing it in the four ADRs would
ship dead surface area.

**Bundle into a `<purity-app>` Custom Element.** Declarative
setup: `<purity-app intercept scroll focus transitions>` in
HTML. Rejected: requires a Custom Element + observed-attribute
parsing. The function form is enough; declarative form is a
separate ADR if anyone wants it.
