# 0009: Request context for SSR components

**Status:** Accepted
**Date:** 2026-05-10

## Context

Until now, Purity SSR components rendered without any access to the
incoming HTTP request. Components knew nothing about the URL, headers,
cookies, or method that triggered the render. That made several
common patterns awkward or impossible:

- **Per-route head tags.** ADR 0008 ships `head()` but a component that
  wants to set `<link rel="canonical">` to the current URL has no way
  to learn what the current URL is.
- **Auth-aware rendering.** Reading a `cookie` header to decide
  Signed-in-vs-signed-out UI requires plumbing auth state through
  component props from the entry point — every component on the path
  pays the cost.
- **i18n via `accept-language`.** Same problem: the language detection
  must happen at the entry point and thread through props.
- **Request-scoped fetches.** Server-side `resource()` calls that need
  the request's bearer token / API key currently have to read globals
  set by the entry point — bad isolation, no concurrency safety.
- **Future server actions / RPC.** ADR-track but unscoped — those
  features will need a request handle to read CSRF tokens and method.

The pattern used by other frameworks (SolidStart's `getRequestEvent`,
SvelteKit's `event`, Next.js's `headers()` / `cookies()`) is to thread
the incoming request through render context. The shipping ecosystem
has converged on the Web Platform `Request` type for this — it's
identical on Node 18+, Bun, Deno, Cloudflare Workers, and Vercel Edge,
and `req.url` / `req.method` / `req.headers.get(...)` is universal.

`SSRRenderContext` already exists and threads several pieces of state
through the render — adding the request is a single new field.

## Decision

**Add `getRequest()` to `@purityjs/core` and a `request?: Request`
option to both `renderToString` and `renderToStream`.** During SSR,
`getRequest()` returns the supplied `Request`; on the client it
returns `null`.

```ts
import { getRequest, head, html } from '@purityjs/core';
import { renderToString } from '@purityjs/ssr';

function PageHead() {
  const req = getRequest();
  if (!req) return; // client render — let the SSR-rendered head stand

  const url = new URL(req.url);
  const canonical = `${url.origin}${url.pathname}`;
  head(html`<link rel="canonical" href="${canonical}" />`);

  const lang = req.headers.get('accept-language')?.split(',')[0] ?? 'en';
  head(html`<meta http-equiv="content-language" content="${lang}" />`);
}

// Server entry
const html = await renderToString(App, { request });
```

Concretely:

- **`request?: Request`** option on `RenderToStringOptions` and
  `RenderToStreamOptions`. Standard Web Platform `Request` — apps on
  any runtime that speaks `fetch` semantics can pass it through
  directly. Omitted for ad-hoc renders that don't correspond to a
  real request (static pre-render, tests).
- **`getRequest()`** function in `@purityjs/core`. Reads from the
  current `SSRRenderContext`. Returns `null` when no SSR context is
  on the stack (client-side, tests, ad-hoc renders without `request`).
  Never throws.
- **Threading through streaming.** `renderToStream` propagates the
  request to both the shell render and every per-boundary render.
  All suspense view functions see the same `Request` instance through
  `getRequest()`, so per-boundary auth checks / per-boundary URL
  decisions work uniformly.
- **Multi-pass renders.** Each pass of the resource-resolution loop
  pushes a fresh `SSRRenderContext` with the same `request`, so
  `getRequest()` returns the same instance on every pass (referential
  equality holds across passes).
- **Adapter responsibility.** The framework expects a real Web
  `Request`. Node servers that have an `IncomingMessage` instead
  convert with one line:
  ```ts
  const req = new Request(`http://${host}${msg.url}`, {
    method: msg.method,
    headers: msg.headers as HeadersInit,
  });
  ```
  Modern Node servers (Hono, Fastify with web-mode, the runtime
  examples in `examples/ssr-stream-*`) already speak `Request`
  directly.
- **No new dependency.** The `Request` constructor is a Web Platform
  built-in on every runtime Purity already supports.

## Consequences

**Positive:**

- Single composable primitive unblocks per-route head tags
  (combines with ADR 0008), auth-aware rendering, i18n routing,
  request-scoped resources, and future server-actions work — all
  without changing the user's component shape.
- Web `Request` is the right abstraction: identical on every runtime
  Purity supports, type-checked by lib.dom, and zero learning curve.
- The option is on the entry points, not on `html` or `component`. No
  parser or codegen changes; no impact on bundle size.
- `getRequest()` is `O(1)` — one `getSSRRenderContext()` lookup plus
  one field read. The function itself is two lines.

**Negative:**

- Adapter responsibility for Node-style servers. Users on raw
  `http.createServer` must construct a `Request` from
  `IncomingMessage`. Documented one-liner; no rendering work.
- No URL-pattern routing primitive yet. `getRequest()` exposes the
  request, but the user still parses the URL and dispatches manually.
  Routing is a separate ADR.
- `getRequest()` returning `null` on the client is a subtle
  surprise — components that branch on the request must handle the
  null case. We document this in the JSDoc and tag every example
  with the early-return.

**Neutral:**

- Components written for both targets pay one extra null check.
  Acceptable given the alternative (a fake client-side `Request`
  filled with `location.*` data) would invite mismatches.
- The package boundary stays in `@purityjs/core` for the same
  reason as `head()`: the function lives at the call site (inside
  user components, which import from `@purityjs/core`). The
  `request` option lives on `@purityjs/ssr`'s entries because
  that's where the value comes in.

## Alternatives considered

**A Purity-shaped `RequestContext` interface.** Custom type with
`{ url, headers, method, cookies }` fields. Rejected: reinvents
the Web Platform `Request` for no benefit and forces users to learn
a Purity-specific shape. Cookie parsing was the one thing `Request`
doesn't ship — but cookie parsing belongs in userland or a focused
helper library, not in framework core.

**Use AsyncLocalStorage / async context tracking.** Could let users
call `getRequest()` from inside async resource fetchers without
explicit threading. Rejected for Phase 1: ALS isn't universally
available on edge runtimes (Workers has it now but it landed late;
Deno's implementation has quirks). The synchronous
`SSRRenderContext` path is universally portable, and resource
fetchers can already capture the request via closure when needed.

**Inject the request as the first argument to `component()` /
`mount()`.** Forces the request to be visible at every component
boundary. Rejected: makes simple components more verbose, and
deeply nested code paths (5+ component levels) would have to
explicitly propagate the request. Implicit context via
`getSSRRenderContext()` is the right tradeoff here.

**Add cookie parsing helpers to the framework.** `getCookie('name')`,
`getCookies()`. Rejected for scope: cookie parsing has many edge
cases (HttpOnly, signed cookies, base64, URL-encoded values) and the
shipping ecosystem has well-tested libraries (e.g. `cookie` on npm).
Users opt in to whichever flavor they need.

**Wrap the request in a `Map`-backed context so user code can also
inject custom values.** Generic "render context" instead of just a
request. Rejected for Phase 1: solves a problem we don't have yet,
and the right abstraction (one named slot per concern: `request`,
`head`, `resolvedData`, …) is the one we're already using on
`SSRRenderContext`. If a future ADR needs an open-ended user
context, we add it then.
