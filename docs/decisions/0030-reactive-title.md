# 0030: `manageTitle(fn)` — reactive `<title>` sync

**Status:** Accepted
**Date:** 2026-05-11

## Context

ADR [0008](./0008-head-meta-management.md) shipped `head(content)` —
an SSR-only helper that appends HTML to the `<head>` accumulator
the renderer surfaces via `renderToString({ extractHead: true })`.
Components call it to emit static `<title>` and `<meta>` tags into
the SSR shell.

`head()` is explicitly a no-op on the client. Once the SSR-rendered
`<head>` is parsed by the browser, the client-side bindings can't
update it — the SSR markup is the only source of truth. This works
for the first paint, but breaks on SPA navigation: `navigate('/about')`
swaps the route view but leaves the page title unchanged. ADR 0008's
deferred non-features called this out:

> **No client-side head management.** Phase 1 only emits the head
> markup on the server. Reactive head element management on the
> client is a follow-up (likely splits into a `@purityjs/head`
> package).

The most common piece of head state that needs to track navigation
is the `<title>`. Browsers display it in the tab strip, screen
readers announce it on route change, history entries use it. The
other head bits (`<meta name="description">`, OG tags) matter less
for SPA UX — search engines crawl the static SSR, social previews
fetch the URL fresh.

This ADR ships a focused reactive helper for `<title>` only.
Broader reactive head management stays deferred (its design space
spans removal / dedup / per-route ownership and warrants its own
ADR).

## Decision

**Add `manageTitle(fn)` to `@purityjs/core`.** Isomorphic:

- **Server.** Once at call time, the function emits
  `<title>${fn()}</title>` into the SSR head accumulator (via the
  existing `head()` mechanism). Returns a no-op teardown.
- **Client.** Wraps `fn` in a `watch()` that writes the result to
  `document.title`. Re-runs on every dependency change. Returns
  the watch teardown.

```ts
import { manageTitle, html } from '@purityjs/core';

function App() {
  manageTitle(() => `Hello ${userName()}`);
  return html`<h1>Hi ${userName()}</h1>`;
}
```

On SSR, the rendered head contains `<title>Hello Anonymous</title>`.
On the client, when `userName()` changes, `document.title` updates
synchronously after the next watch flush.

Concretely:

- **`manageTitle(fn: () => string): () => void`** — accepts a
  signal-reading function. The function is called inside a
  `watch()` on the client; subscribers track exactly as they would
  inside a template binding.
- **Server behavior**: emits `<title>${escapedTitle}</title>`
  through `head()` so the SSR head accumulator picks it up.
  Escaping uses the existing SSR `escHtml` to keep tags / quotes
  in titles safe. Multiple `manageTitle` calls during one SSR
  render emit multiple `<title>` tags; the browser ignores all
  but the last per HTML spec — that's identical to multiple
  `head(html\`<title>…\`)` calls, so no special dedup needed.
- **Client behavior**: synchronous title write inside the
  `watch()` callback. No microtask wrap — title changes are
  cheap and idempotent. The watch auto-disposes when the
  surrounding component (if any) unmounts; outside of a
  component context the watch lives until manual teardown.
- **Return value**: the watch teardown on the client; a no-op
  on the server (no listener to remove). Apps that want to stop
  managing the title call the returned function.
- **Reads stale on hydration**: when the client hydrates over
  the SSR-rendered title, the first `manageTitle` call runs the
  watch and writes `document.title = fn()`. If `fn()` produces
  exactly the SSR-rendered title, the write is a no-op; if it
  produces something different (because some client-only state
  shifted between SSR and hydration), the title updates. This
  matches the documented "self-heal" behavior of `enableHydration
TextRewrite` (ADR 0007).

### Explicit non-features

- **No reactive `<meta>` / OG tag management.** Out of scope for
  this ADR. A follow-up `manageMeta(name, fn)` would extend the
  pattern; defer until apps actually need it.
- **No template-tag form.** A reactive `<title>` could be a
  template that's mounted into a synthetic head node. Rejected:
  the function form is direct, side-effecting, and matches the
  existing `head()` shape. The template form adds a render
  pipeline that bypasses the existing head accumulator.
- **No SSR-side dedup.** If two components call `manageTitle`
  during the same render, both `<title>` tags are emitted. The
  HTML spec says only the last `<title>` element in `<head>`
  applies; same behavior as direct `head(html\`<title>…\`)`
  calls today.
- **No "title format" helper.** Apps wanting prefix/suffix
  patterns (`'My Site — '`) build the string themselves inside
  `fn`. A `manageTitle({ template: 'My Site — :title' })`
  abstraction is over-engineered for Phase 1.
- **No undoing on teardown.** When the watch is torn down on the
  client, `document.title` is NOT reverted. Apps that want
  restore-on-unmount semantics save the original title before
  calling and restore it manually.
- **No interaction with the `<title>` rendered by `head()`.**
  Both can coexist — a route can emit a static `<title>` via
  `head(html\`<title>X</title>\`)`and a reactive`<title>`via`manageTitle(() => …)`. The SSR emits both; the browser uses
the last; the client's `manageTitle` then takes over.

## Consequences

**Positive:**

- Closes the documented ADR 0008 non-feature for the most
  visible client-side head case. SPA navigation now updates the
  tab title without manual `document.title = …` calls in every
  route component.
- Isomorphic API. One function, both runtimes. Tree-shakes when
  unused.
- ~15 LOC of new code. Watch + `document.title =` on the client;
  one `head()` call on the server.
- Composes with `currentPath()` (ADR 0011), `loaderData()` (ADR
  0026), and any user signal. Apps wire up
  `manageTitle(() => loaderData<{title}>()?.title ?? 'Default')`
  trivially.

**Negative:**

- Reactive head management is broader than `<title>` alone. Apps
  with reactive meta needs still write their own
  `watch(() => { document.querySelector('meta[name=description]')
?.setAttribute('content', …) })`. Documented as a non-feature;
  follow-up ADRs can extend.
- The watch lifetime is the caller's responsibility outside a
  component context. Apps wiring `manageTitle` at module load
  capture a permanent watch until manual teardown — matches the
  other `manage*` helpers (scroll/focus/transitions).

**Neutral:**

- One new export (`manageTitle`). The existing `head()` stays
  unchanged.
- Tests cover SSR head emission (head[] contains the rendered
  `<title>` tag) and client-side watch behavior (jsdom
  `document.title` updates on signal change).

## Alternatives considered

**Make `head()` reactive when given a function** (auto-rerun on
signal change, re-emit). Rejected: `head()` is SSR-only and
designed for one-shot string output. Reactive re-emit would
require client mutation of the SSR-rendered nodes — a larger
design (selecting, dedup, removal) than this ADR's scope.

**Custom Element `<purity-title>`** with a `value` attribute
bound to a signal. Declarative and template-friendly. Rejected:
adds a Custom Element to the bundle; the function form composes
inside any component already.

**Ship a `manageHead(reactiveFn)` that updates both SSR head +
client `document.title`/`<meta>` via direct DOM queries.**
Generalises this ADR to all head elements. Rejected for Phase 1:
client-side DOM queries to find existing elements + create new
ones for missing tags get complicated quickly (per-name dedup,
attribute mutation vs element replacement). `manageTitle` is the
80% case shipped on its own; broader management follows when
the use cases crystallise.

**Always wrap the title in a fixed template** (e.g.
`'Purity — :title'`). Rejected: apps with different prefixes have
to provide the whole string anyway. Format helpers compose
trivially in user-land.

**Take a signal directly rather than a function**
(`manageTitle(titleSignal)`). Rejected: forces apps to build a
signal even when the title comes from `loaderData()` or
`currentPath()` directly. The function form accepts both
(signals are callable, `loaderData()<T>()` is a function call).
