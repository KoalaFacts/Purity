# 0011: Router primitives

**Status:** Accepted
**Date:** 2026-05-10

## Context

ADR [0009](./0009-request-context.md) exposes the incoming `Request`
via `getRequest()` and the SSR example refactor in the same iteration
showed a typical use:

```ts
const req = getRequest();
const path = req ? new URL(req.url).pathname : window.location.pathname;
if (path === '/') return HomePage();
if (path === '/about') return AboutPage();
...
```

That dispatch is correct but every Purity user shipping more than one
route will reinvent it. Three pieces of boilerplate recur:

- **Cross-target path reading.** Every component that wants the path
  must branch on "server (via getRequest) vs client (via
  window.location)". Easy to get subtly wrong — e.g., the server
  branch missing the `URL` wrap, or the client branch not being
  reactive so navigation doesn't trigger a re-render.
- **History API integration.** Client-side soft navigation needs
  `pushState` + a `popstate` listener + a reactive signal that
  re-renders watchers when either fires. The pieces are small; the
  glue is annoying.
- **Pattern matching.** Even tiny apps want `/users/:id` or
  `/blog/*` style captures. Hand-rolled `split('/')` matchers are
  ten-line snippets that everyone writes slightly differently.

A full file-system router is its own ADR (substantial — needs Vite
plugin scanning, layout nesting, route trees). But three small
primitives cover ~80% of the value at ~80 lines of code:

1. A reactive `currentPath()` that works on server and client.
2. A `navigate(href)` that updates History and the reactive signal.
3. A `matchRoute(pattern)` that handles `:param` + `*` splat.

These compose to a hand-rolled router (one `matchRoute` call per
route entry) without locking the user into a Purity-specific routing
convention.

## Decision

**Ship three router primitives in `@purityjs/core`: `currentPath()`,
`navigate(href, options)`, and `matchRoute(pattern, path?)`.** No
file-system convention, no `<Route>` component, no route tree —
those land in a future ADR if the demand is there. Phase 1 is the
minimum that closes the per-app boilerplate.

```ts
import { currentPath, matchRoute, navigate, html } from '@purityjs/core';

function App() {
  if (matchRoute('/')) return HomePage();
  const m = matchRoute('/users/:id');
  if (m) return UserPage(m.params.id);
  return NotFound();
}

html`<a
  href="/about"
  @click=${(e) => {
    e.preventDefault();
    navigate('/about');
  }}
  >About</a
>`;
```

Concretely:

- **`currentPath(): string`** — reactive accessor for the current URL
  pathname.
  - On the **server** (inside a `getSSRRenderContext()`-bearing call),
    reads `new URL(request.url).pathname` from the SSR-supplied
    `Request`. Returns `'/'` when no request was supplied.
  - On the **client**, reads a module-scoped signal initialised from
    `window.location.pathname` at module load. The signal is kept
    in sync with `popstate` events and `navigate()` calls. Reading
    `currentPath()` from inside a `watch()` / reactive template
    subscribes to changes.
- **`navigate(href, options?: { replace?: boolean }): void`** —
  pushState + update the reactive signal. No-op on the server. Same-
  origin only (cross-origin hrefs are silently ignored; callers
  should set `window.location` directly for full-page nav). Default
  is `pushState`; `{ replace: true }` uses `replaceState` so the
  back-stack isn't extended.
- **`matchRoute(pattern, path?): { params } | null`** — pattern
  matcher. Grammar:
  - Literal segments — `/about`, `/users/edit`
  - `:name` — captures one path segment into `params.name`,
    URI-decoded so `Ada%20Lovelace` → `'Ada Lovelace'`
  - `*` — matches the remainder; captured under `params['*']`
    Returns `null` on miss (including paths with trailing segments
    the pattern doesn't consume — `/about` doesn't match `/about/x`).
    Path defaults to `currentPath()` so calls inside a reactive
    context auto-track.

Three exports total. No new types beyond `NavigateOptions` and
`RouteMatch`. ~80 LOC of implementation. Compiled into the
client bundle only when imported.

### Explicit non-features

- **No `<Route>` / `<Routes>` component or route tree.** Users write
  `if (matchRoute(...)) return …` in the body of their `App()`. The
  trade is "less magic, more lines for very large apps." A future ADR
  can layer a `<Routes>` helper on top of these primitives if needed.
- **No link interception.** Each `<a href>` opts into client-side
  nav by handling `@click` and calling `navigate()`. A global
  click listener that converts every internal `<a>` to a soft nav
  is convenient but adds nontrivial behavior (modifier keys, target
  attribute, download links, full-page reloads on form submit, …);
  defer to a follow-up.
- **No layout/nesting primitive.** Single flat route table.
- **No data loaders / pending UI.** That space is already covered by
  `resource()` + `suspense()`; the router doesn't try to re-invent
  them.
- **No URL search / hash signals.** `currentPath()` is just the
  pathname. Reading search / hash means constructing
  `new URL(window.location.href)` directly. Reactivity for search-
  param changes can come in a follow-up if there's demand.
- **No filesystem-based route discovery.** The big one — a
  `pages/`-style convention with file scanning + nested layouts —
  is a separate ADR.

## Consequences

**Positive:**

- Closes the per-app routing boilerplate without picking a routing
  convention. Users on edge runtimes, traditional Node servers, SSG,
  or pure client SPAs all use the same three functions.
- Server / client parity. `currentPath()` returns the same value at
  the same render point regardless of execution context, so SSR'd
  markup matches what the client will produce on first hydrate.
- No bundle cost for apps that don't import these. Tree-shakeable.
- Composes with the rest: `getRequest()` for header / cookie reads,
  `head()` for per-route `<title>`, `matchRoute()` for dispatch.
  Combined output is a small, complete app shell.

**Negative:**

- Manual route table. A 30-route app writes 30 `if (matchRoute(…))`
  branches. Annoying at scale, fine until the demand for a
  declarative route tree justifies the next ADR.
- Manual `@click` interception. Every `<a>` that wants soft-nav adds
  six lines of event handling. Boilerplate, but explicit boilerplate
  beats magic that breaks modifier-clicks.
- Path-only matching. Pattern can't constrain on search params or
  hash; users do that with `new URL(req.url)` and an extra
  conditional.
- No middleware / guards. Auth checks happen in the route handler
  (`if (!loggedIn) return SignInPage()`).

**Neutral:**

- Three exports added to the public surface of `@purityjs/core`.
  Tree-shaken when unused.
- `matchRoute` returns its `params` as a plain
  `Record<string, string>`. Typed inference per-pattern would need
  generics gymnastics that hurt readability; users cast or assert
  where types matter.

## Alternatives considered

**Ship a full SolidStart-style router with `<Routes>`, `<Route>`,
nested layouts, loaders, and link interception.** Rejected for Phase 1
scope. The right shape for a Purity router will become clearer once
the framework has a file-system convention and a layout primitive;
shipping a router first would commit to a layout shape before the
right shape is known.

**Provide only `currentPath()`; leave `matchRoute()` and `navigate()`
to userland.** Rejected: `navigate()` is too easy to write wrong (the
popstate listener is the bit users forget), and `matchRoute()` is
small enough to ship correctly once. Three primitives is the right
unit.

**Return a `URL` from `currentLocation()` instead of a string from
`currentPath()`.** Tempting — URL exposes pathname, search, and hash
in one go. Rejected because URL construction is non-trivial on hot
paths (each call allocates) and the 95% case wants just the
pathname. If search-param reactivity becomes a thing, add it as
separate `currentSearch()` / `currentHash()` accessors so callers
opt in.

**Auto-intercept all internal `<a>` clicks via a global listener.**
Convenient but subtly behavior-breaking — modifier keys (cmd+click
to open in new tab), `target="_blank"`, download links, in-page hash
anchors, and `<form>` submissions all need careful exemption.
Defer to a follow-up that gets the precedence right.

**Use the History API directly without a reactive signal layer.**
Rejected: components reading the path inside reactive templates
need a way to subscribe to changes. The signal is the cleanest
primitive for that on Purity's reactivity model.
