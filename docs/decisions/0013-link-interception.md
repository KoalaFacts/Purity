# 0013: Link auto-interception

**Status:** Accepted
**Date:** 2026-05-10

## Context

ADR [0011](./0011-router-primitives.md) shipped `navigate(href)` as
the programmatic way to change the URL on the client. The pattern at
each call site is:

```ts
html`<a
  href="/about"
  @click=${(e) => {
    e.preventDefault();
    navigate('/about');
  }}
  >About</a
>`;
```

Five lines per link. The SSR example I updated as part of ADR 0011
ended up with four near-identical inline handlers — one per link.

Every router shipping in production handles this with a global click
listener that converts qualifying `<a>` clicks into client-side
navigations. The exemption list is well-known (modifier keys,
target attribute, download, cross-origin, hash-only). The
implementation is ~30 lines once you write the predicate.

ADR 0011 explicitly punted on this primitive ("link interception is
out of scope for Phase 1") because the right shape — global vs.
per-component opt-in, default predicate vs. user-supplied — wasn't
obvious yet. After spending an iteration writing the same
boilerplate four times, the answer is clear: global, opt-in via a
single call, with a conservative default predicate and an opt-out
attribute for the rare per-link exception.

## Decision

**Add `interceptLinks(options?)` to `@purityjs/core`.** Single
global click listener on `document`. Default predicate exempts
modifier keys, non-`_self` targets, `download` links, cross-origin
hrefs, hash-only same-page links, already-prevented events, and
elements carrying a `data-no-intercept` attribute. Surviving clicks
call `event.preventDefault()` + `navigate(anchor.href)`.

```ts
// entry.client.ts
import { hydrate, interceptLinks } from '@purityjs/core';
import { App } from './app.ts';

hydrate(document.getElementById('app')!, App);
interceptLinks();
```

Views drop their inline handlers:

```ts
// Before (ADR 0011):
html`<a
  href="/about"
  @click=${(e) => {
    e.preventDefault();
    navigate('/about');
  }}
  >About</a
>`;

// After (ADR 0013):
html`<a href="/about">About</a>`;
```

Concretely:

- **`interceptLinks(options?: { shouldIntercept? }): () => void`** —
  installs one global click listener (capture phase isn't needed;
  the default-bubble listener fires after per-element handlers).
  Returns a teardown function for tests / HMR. No-op on the server
  (no `document`). Calling it twice while a previous interception
  is active is a no-op + console warning — call the prior teardown
  first.
- **Default predicate exempts:**
  - `event.button !== 0` (middle / right-click, follow native UA behavior)
  - any modifier key (`metaKey`, `ctrlKey`, `shiftKey`, `altKey`)
  - `target` attribute set to anything other than empty or `_self`
  - `download` attribute present
  - cross-origin `href` (different `a.origin`)
  - hash-only same-page links (`/page#section` from `/page` — let
    the browser scroll natively)
  - `event.defaultPrevented` already true (another listener bailed)
  - `data-no-intercept` attribute on the `<a>` (per-link opt-out)
- **`shouldIntercept` option replaces the default entirely.** When
  supplied, your predicate fully replaces the default — include the
  exemption checks you still want. This avoids the "additive
  predicate" footgun where users override one bit and silently
  inherit edge cases they didn't read about.
- **`closest('a')`** is used to find the link from a nested click
  target (e.g. `<a><span><strong>click</strong></span></a>`).

### Explicit non-features

- **No focus management / scroll restoration.** A real router needs
  to handle scroll position on back-nav, focus on route change, and
  announce navigation to screen readers. Each is its own follow-up.
- **No view transitions API integration.** `document.startViewTransition`
  pairs nicely with this primitive but is a separate ADR.
- **No prefetch-on-hover.** Common in production routers; needs
  resource-cache integration and adds complexity. Defer.
- **No data-prefetch attribute / link priorities.** Same.
- **No `<purity-link>` Custom Element.** A Custom Element wrapper
  would let the framework own the click listener per-instance instead
  of globally, but it pushes a component boundary onto every link.
  Global interception is simpler and the right primitive layer.

## Consequences

**Positive:**

- Drops ~5 lines per link in user code. The SSR example shrunk by
  20+ lines.
- Zero runtime cost for apps that don't call `interceptLinks()` —
  tree-shaken.
- Default predicate is conservative: matches user expectation for
  cmd-click-to-open-tab, target="\_blank", external links, file
  downloads, etc. Apps don't have to write the exemption logic
  themselves.
- Works without any change to existing user templates — `<a href>`
  was already correct markup; previously the user had to layer
  manual handlers on top, now they don't.

**Negative:**

- One global listener on the document. Negligible cost (single
  `document.addEventListener`); negligible behavior unless the user
  has many other click listeners that depend on default behavior.
  The default predicate's `defaultPrevented` check prevents most
  collisions, but unusual flows that rely on the `<a>` natively
  navigating after their own handler ran would need
  `data-no-intercept`.
- Per-link opt-out is a magic attribute name. `data-no-intercept`
  is reasonable but not standard. The alternative (a CSS class
  convention, a Symbol-tagged element, etc.) is worse.
- The "replace, don't extend" predicate semantic means custom
  predicates have to re-implement exemptions they want to keep.
  Documented; explicit beats subtle additive composition.

**Neutral:**

- Two exports added (`interceptLinks`, `InterceptLinksOptions`).
  Tree-shaken when unused.
- Server-side no-op. Components can call `interceptLinks()` from
  shared code without target-detection branches; it just does
  nothing on the server.
- Per-iteration teardown via the returned function makes test
  isolation clean and HMR-friendly.

## Alternatives considered

**Per-component `<purity-link>` Custom Element.** Encapsulates click
handling at the component layer. Rejected: every link in the app
now goes through a Custom Element rather than a native `<a>`,
losing native semantics (right-click "Open Link in New Tab" still
works, but the surrounding DOM is more complex). Global interception
keeps the markup unchanged.

**Additive `shouldIntercept` that runs after the default.** Let the
user veto only a subset. Rejected for the "extend silently" footgun
— a user adding `shouldIntercept: (e, a) => a.dataset.spa === 'true'`
expecting to opt-in their links would actually skip every link
because the default already returned `false` for those without the
data attribute. Replace-the-whole-predicate semantics are blunt but
unambiguous.

**Auto-install when `navigate()` is imported.** Removes the explicit
call site. Rejected: side-effect imports are an anti-pattern; users
expect importing `navigate` to import a function, not install a
document-level listener. Explicit `interceptLinks()` matches the
explicit-by-default contract of every other shipped primitive.

**Use `capture: true` to intercept before user listeners.** Would
catch clicks even when downstream listeners do their own preventDefault.
Rejected because that's the wrong default — if a downstream handler
explicitly calls `event.preventDefault()` for its own flow, the
router should bail. The default predicate respects
`event.defaultPrevented` for exactly this reason.

**Built-in scroll-restoration / focus-on-nav.** Each is a deserving
follow-up that needs careful design (where to restore scroll for
back-navigation, what focus target on programmatic nav, how to
integrate with view transitions). Phase 1 stays minimal.
