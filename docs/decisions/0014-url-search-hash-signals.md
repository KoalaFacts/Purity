# 0014: URL search and hash signals

**Status:** Accepted
**Date:** 2026-05-10

## Context

ADR [0011](./0011-router-primitives.md) shipped `currentPath()` —
reactive pathname access with SSR/client parity. The deferred items
in that ADR included URL search and hash reactivity:

> **No URL search / hash signals.** `currentPath()` is just the
> pathname. Reading search / hash means constructing
> `new URL(window.location.href)` directly. Reactivity for search-
> param changes can come in a follow-up if there's demand.

That follow-up is now obvious. Three patterns recur across SPAs:

- **Pagination.** `?page=N` reactivity — clicking Next updates the
  URL, the list re-renders with the new page.
- **Filters / search.** `?sort=date&filter=open` reactivity — sidebar
  controls write to the URL; the list reads from it.
- **Tabs / accordions via hash.** `#section-2` reactivity — anchor
  links open the right section, deep links work.

Each currently needs the user to call `new URL(window.location.href)`
inside a `watch()` and manually wire up `popstate` + `hashchange`
listeners to drive the reactivity. That's ~15 lines per app of
boilerplate that the router primitives module should already own.

The implementation is a single signal-typing change: instead of
storing `string` (pathname only), store `URL`. Three new accessors
read different parts. popstate + hashchange listeners refresh the
signal on browser-driven URL changes.

## Decision

**Add `currentSearch()` and `currentHash()` to `@purityjs/core`,
backed by the same reactive signal as `currentPath()`.** Refactor
the internal `pathSignal: state<string>` to `urlSignal: state<URL>`.
Listen to `hashchange` alongside `popstate` so hash-only nav
(via non-intercepted `<a href="#x">`) drives the same signal.

```ts
import { currentSearch, currentHash, currentPath, navigate, html } from '@purityjs/core';

function Paginator() {
  const page = Number(currentSearch().get('page') ?? '1');
  return html`
    <p>Page ${page}</p>
    <button
      @click=${() => {
        const next = new URLSearchParams(currentSearch());
        next.set('page', String(page + 1));
        navigate(`${currentPath()}?${next}`);
      }}
    >
      Next
    </button>
  `;
}
```

Concretely:

- **`currentSearch(): URLSearchParams`** — reactive accessor for
  `URL.searchParams`. Returns a **fresh copy** each call so caller
  mutations don't affect the underlying URL — the URL is
  authoritative; changes go through `navigate()`. SSR reads use
  `new URL(request.url).searchParams` from `getRequest()`. Returns
  empty params when no query string is present.
- **`currentHash(): string`** — reactive accessor for `URL.hash`,
  including the leading `#`. Returns the empty string when no hash
  is present. SSR + client behavior identical to `currentSearch()`.
- **Internal refactor: `pathSignal` → `urlSignal`.** All three
  accessors read from the same `state<URL>` so `watch()` subscribers
  re-fire on any URL change (path, search, or hash). The
  `currentPath()` API is unchanged; tests are unchanged; the
  performance impact is one extra `URL` allocation per navigate
  call (negligible).
- **New `hashchange` listener.** Hash-only nav (e.g. clicking an
  `<a href="#anchor">` that `interceptLinks()` exempted via the
  hash-only-same-page rule) updates `window.location.hash`
  natively; the browser fires `hashchange`. We refresh `urlSignal`
  in response. popstate keeps handling history back/forward.

### Explicit non-features

- **No `setSearch(params)` / `setHash(hash)` write helpers.** Users
  build the new href and call `navigate()` directly. Composability
  beats five overloads of "subtly different ways to mutate the
  URL." If the boilerplate becomes painful, a future ADR can add
  the helpers; today's pattern is one line.
- **No detection of pushState-without-event.** A user calling
  `history.pushState(null, '', '?page=2')` directly bypasses
  `navigate()`, and there's no DOM event we can hook to refresh
  the signal. Document the contract: use `navigate()` for URL
  changes, or call `urlSignal` refresh manually via popstate.
- **No `URL` object accessor.** Returning the full `URL` would
  expose mutable methods that don't drive reactivity (e.g.,
  `url.searchParams.set(...)` mutates the URL but doesn't fire
  the signal). Returning typed slices is safer.

## Consequences

**Positive:**

- Closes the search/hash boilerplate without inventing new
  primitives — same reactive contract as `currentPath()`. Apps
  reading `currentSearch().get('page')` in a `watch()` get
  rerender-on-URL-change for free.
- One reactive signal under the hood. Memory + complexity stays
  flat; the new accessors are five lines each.
- Hashchange handling covers the most common "non-`navigate()` URL
  change" case (anchor links, programmatic `location.hash = …`).
  Previous router behavior didn't see those.

**Negative:**

- Each `currentSearch()` call allocates a `URLSearchParams` copy.
  Negligible for typical app usage; do-not-call-in-tight-loops.
- `pushState`-without-navigate is still invisible to the signal.
  Users mixing direct History API calls with framework primitives
  need to know the contract. Documented.
- `currentSearch().set(…)` doesn't navigate. Surprises users coming
  from frameworks where the URL object is reactive end-to-end.
  Docstring + ADR call this out.

**Neutral:**

- Two exports added (`currentSearch`, `currentHash`). Tree-shaken
  when unused.
- SSR parity is preserved: search and hash read from
  `new URL(request.url)` of the SSR-supplied Request, same source
  as `currentPath()`.

## Alternatives considered

**Return a full `URL` instance from `currentLocation()` instead of
three accessors.** Single export, all parts in one. Rejected:
URL exposes mutable methods (`url.searchParams.set`, assignment
to `url.pathname`) that don't drive the signal; users would write
`currentLocation().searchParams.set('page', '2')` expecting it to
navigate. Slicing into typed accessors makes the immutability
contract obvious.

**Track search and hash as separate signals.** One signal each for
pathname, search, hash so a watch only re-fires on the part it
reads. Rejected for negligible savings (URL changes are infrequent
compared to other reactive work) at the cost of three signals to
keep in sync. Single source of truth is simpler.

**Return a reactive `URLSearchParams` proxy that auto-navigates
on mutation.** Auto-magic but a footgun — users would call
`.set('foo', 'bar')` from a render and trigger an immediate
navigation mid-render. Explicit `navigate()` calls beat implicit
side effects.

**Drop `currentPath()` in favor of `currentLocation().pathname`.**
Forces every reader to allocate the URL. Rejected: keeping the
existing `currentPath()` API stable is essential (it was just
shipped in ADR 0011); deprecation churn isn't worth the surface
unification.
