# 0008: Per-component head / meta tag management

**Status:** Accepted
**Date:** 2026-05-10

## Context

Purity SSR apps render a component to an HTML string that the user
splices into a hand-written shell:

```html
<!doctype html>
<html>
  <head>
    <title>Purity App</title>
    <meta name="description" content="…" />
  </head>
  <body>
    <div id="app"><!--ssr-outlet--></div>
  </body>
</html>
```

The `<head>` lives outside the rendered component. That makes per-page
title / meta / link tags awkward: users either accept one static head
shared by every route or write their own per-request shell-template
substitution. Every shipping framework — Next, SolidStart, SvelteKit,
Astro, Nuxt — exposes some way for components to contribute head tags
(`<Title>`, `next/head`, `<svelte:head>`, etc.). Purity's omission was
a known gap in the SSR MVP.

The gap is small in scope (one new function, one new option on
`renderToString`) but the API has to commit to a few decisions:

1. **Where do head tags live in source?** Inline JSX-style children
   inside a `<Head>` wrapper, or function calls?
2. **How do they propagate to the SSR output?** Side-channel collected
   on `SSRRenderContext`, or a separate render pass that walks the
   rendered output for `<head>` candidates?
3. **What's the client story?** Server-only, no-op on client, or full
   reactive `<head>` element management?

This ADR ships **Phase 1**: function-call API, SSRRenderContext side-
channel, server-only collection. Phase 2 (reactive client-side head)
gets its own ADR once we have a real user driving it.

## Decision

**Add `head(content)` to `@purityjs/core` and an `extractHead`
option to `renderToString` that returns the collected head HTML
alongside the body.** Function-call API, side-channel collection on
the SSRRenderContext, server-only effect for Phase 1.

```ts
import { head, html } from '@purityjs/core';

function PageHead({ title, description }: { title: string; description: string }) {
  head(html`<title>${title}</title>`);
  head(html`<meta name="description" content="${description}" />`);
}

function App() {
  return html`
    ${PageHead({ title: 'My Page', description: 'Welcome' })}
    <main><h1>Hi</h1></main>
  `;
}

// Server
const { body, head: headHtml } = await renderToString(App, { extractHead: true });
const finalHtml = template.replace('<!--head-->', headHtml).replace('<!--ssr-outlet-->', body);
```

Concretely:

- **`head(content)`** accepts `SSRHtml`, a thunk returning `SSRHtml`, or
  any value the shared `valueToHtml` coercion understands (primitives,
  arrays, branded SSR HTML). The thunk is called once, the result is
  coerced to HTML, and the string is appended to `ssrCtx.head[]` on the
  current `SSRRenderContext`.
- **`extractHead: true`** on `renderToString` flips the return shape
  from `Promise<string>` to `Promise<{ body, head }>`. The `body` field
  is byte-for-byte identical to the legacy string return; only the
  envelope changes. The TypeScript overload is keyed on the option, so
  apps that don't pass it keep the legacy return.
- **Multi-pass behavior.** The renderer resets `ctx.head` at the start
  of each pass and captures the final pass's value. Resource-dependent
  head content (`head(html\`<title>${() => res()}</title>\`)`) ends up
  with the resolved value, not the loading placeholder.
- **Client.** `head()` is a no-op when there is no `SSRRenderContext`
  on the stack. The browser already shows the SSR-rendered `<head>`;
  client-side reactive head element management is out of scope here.
- **Outside any render context.** Bare `head()` calls (tests, ad-hoc
  client code) are silent no-ops. No throw, no warn — too much
  ceremony for what is effectively a side-effect dropper.

Streaming (`renderToStream`) does **not** consume `head()` calls in
this ADR. The shell flushes before head() collection completes per
boundary, and the head section has already been parsed by the browser
by the time later chunks arrive. Streaming support is a follow-up
that's likely to require either an HTML5 `<head>` parser hook or
moving head tags to a deferred-script injection model.

## Consequences

**Positive:**

- One new function plus one option closes the longest-standing
  framework-level SSR gap. Apps with per-page title / description /
  canonical / OG tags work end-to-end with the existing
  `renderToString` flow.
- Zero breaking change. The default `renderToString` return type and
  byte output are unchanged. Apps that don't call `head()` see no
  difference.
- The collected HTML uses the same `valueToHtml` coercion as everything
  else — branded SSR HTML, escape rules, and reactive accessors all
  Just Work. Users can call any composable head helper they want, no
  custom escaper needed.
- The side-channel is on `SSRRenderContext`, which already exists. No
  new global state, no new lifecycle phase.

**Negative:**

- No client-side head management in Phase 1. SPAs that transition
  between routes client-side won't update `<title>` from `head()`.
  Users mutate `document.title` directly until Phase 2.
- No deduplication. Multiple `head()` calls that emit `<title>`
  elements all end up in the head — the browser uses the first. Real
  apps will want a single `<Title>` helper that coordinates dedup,
  but that's userland for now.
- Streaming SSR doesn't see `head()` output. Apps that stream and want
  per-page head must use `renderToString` instead, or manage the head
  outside the framework.

**Neutral:**

- The function-call API (vs. a `<Head>` JSX-style component) matches
  Purity's overall ethos — `state`, `compute`, `watch`, `resource`,
  and now `head` are all plain functions. No new component shape.
- **Package boundary decision (Phase 1).** `head()` lives in
  `@purityjs/core` rather than a new `@purityjs/head` package. The
  function is 12 lines and entirely tree-shakable, so apps that don't
  call it pay zero bytes. The user-facing call site (inside a
  component) naturally sits next to `html` / `state` / `watch` in the
  same import. **Re-evaluate when Phase 2 lands** — reactive client
  head element management + deduplication + OG/Twitter/JSON-LD helpers
  will earn a dedicated package; we'll split into `@purityjs/head`
  with peer-deps on `@purityjs/core` (for `getSSRRenderContext`,
  `watch`) at that point. The import path change is breaking but
  contained — userland updates one line per file.

## Alternatives considered

**JSX-style `<Head>` wrapper component.** Solid/Next style. Rejected:
Purity doesn't have JSX. Adding a Custom Element variant would create
two patterns (an `html` template inside a `<purity-head>` wrapper) and
an ordering problem (the wrapper's children would need to be hoisted
out of the rendered body and into the head section, which conflicts
with the streaming Suspense model in ADR 0006).

**Always include `head()` output in the body string at a marker.**
The user finds `<!--purity-head-->...<!--/purity-head-->` in the
output and moves it. Rejected: forces every consumer to parse the
output, and "find the marker pair in a string" is exactly what we
gave users a typed API to avoid.

**Add `head()` to `@purityjs/ssr` instead of `@purityjs/core`.**
Considered. Rejected because `head()` is the only sensible way for
user components — which import from `@purityjs/core` — to contribute
to the head from inside a component. Splitting the API would force
users to import a server-only function from the client bundle entry
purely for declaration ergonomics.

**Synchronous head injection during the render pass.** Add a hook to
`generateSSR` that writes head tags inline to a separate buffer.
Rejected: would require parser/codegen changes for a feature that
fits naturally into a runtime side-channel.

**Full reactive client-side `<head>` management in Phase 1.** Each
`head()` call becomes a reactive watcher that mutates
`document.head`. Rejected for scope — needs a deduplication strategy
(replace existing `<title>`, append new `<meta>`), cleanup on
unmount, and hydration-time matching against SSR-rendered head
elements. Phase 2.
