# 0012: Server actions / form-enhancement primitive

**Status:** Accepted
**Date:** 2026-05-10

## Context

Purity ships read-side SSR (`renderToString`, `renderToStream`,
`renderStatic`) but has no write-side primitive — no built-in way for
a component to declare "this URL handles a POST." Users currently
wire their own `<form>` handlers into `http.createServer` or their
edge function, and pass the action URL into components as a prop.
That works but produces three recurring frustrations:

- **Boilerplate.** Every action is `if (req.url === '/api/foo' &&
req.method === 'POST') { … }`. Each app reinvents the dispatch.
- **Co-location.** The action handler and the `<form action="…">`
  that targets it live in different files, often different packages.
  Easy to drift; hard to refactor.
- **No progressive-enhancement story.** Frameworks shipping a server-
  actions primitive (Remix, SvelteKit, Next App Router) all enable
  the same pattern: `<form action="…" method="POST">` works without
  JS via native browser submission. Purity should support the same.

The shape of the right primitive isn't controversial — declare an
action with a URL + handler, get back something whose `.url` is
spliced into `<form>` markup; on the server entry, dispatch matching
POSTs to the registered handler. The question is how minimal it can
be while still being useful.

## Decision

**Ship three exports in `@purityjs/core`: `serverAction(url, handler)`,
`findAction(request)`, and `handleAction(request)`.** No CSRF
machinery, no auto-serialization, no client-side `invoke` helper — just
a registry + dispatcher pair. Phase 1 closes the boilerplate gap with
~50 LOC.

```ts
// app/save-todo.action.ts (server-only module)
import { serverAction } from '@purityjs/core';

export const saveTodo = serverAction('/api/save-todo', async (request) => {
  const data = await request.formData();
  const text = String(data.get('text') ?? '');
  if (!text) return new Response('text required', { status: 400 });
  await db.insert({ text });
  // Post-Redirect-Get back to the list page.
  return Response.redirect(new URL('/', request.url).toString(), 303);
});

// In a server-rendered component
html`<form action=${saveTodo.url} method="POST">
  <input name="text" />
  <button>Save</button>
</form>`;

// In your server entry, before SSR
import { handleAction } from '@purityjs/core';

const actionResponse = await handleAction(request);
if (actionResponse) return actionResponse;
// …else render the page normally.
```

Concretely:

- **`serverAction(url, handler): ServerAction`** — registers
  `(url, handler)` in a process-global `Map`. Returns
  `{ url, handler }` so the call site can splice `.url` into markup
  and tests can invoke `.handler` directly. Duplicate `url`
  registration is last-wins (matches Vite HMR semantics — re-import
  a module, re-register the handler). Throws on empty url or
  non-function handler.
- **`findAction(request): ServerActionHandler | null`** — looks up
  by `new URL(request.url).pathname`. Returns the registered
  handler (not yet invoked) on hit, `null` on miss. Use this when
  you want to inspect before dispatching.
- **`handleAction(request): Promise<Response | null>`** — find +
  invoke + await. Returns the handler's `Response` on hit, `null`
  on miss so the caller can fall through to SSR or another router.
- **Handler signature: `(request: Request) => Promise<Response> |
Response`.** Pure Web Platform. Parse `formData()` / `json()` /
  `text()` yourself. Return any `Response` — redirect, JSON, HTML, 204. Handlers can read cookies, set headers, anything `Response`
  supports.
- **Progressive enhancement.** `<form action="/api/save" method="POST">`
  posts FormData natively. The handler returns a 303 redirect; the
  browser does a GET to the Location. Works without JS. JS apps
  intercept the submit and call `fetch(url, { method: 'POST', body:
formData })` for SPA UX; both call the same handler.

### Explicit non-features

- **No CSRF token generation / verification.** SameSite cookies +
  double-submit pattern (or a focused library like `cookie-signature`
  or `oslo/csrf`) covers this for most apps. A built-in helper would
  pick one strategy and discourage the others.
- **No auto-serialization of JS arguments.** Handlers take a real
  `Request` and respond with a real `Response`. Auto-serializing
  arbitrary JS values needs a wire format, a versioning story, and
  trust boundaries — out of Phase 1 scope. Users who want RPC-style
  ergonomics build their own thin wrapper on top.
- **No client-side `action.invoke(formData)` helper.** A 6-line
  `fetch(action.url, { method: 'POST', body: formData })` call site
  isn't worth abstracting until the request shape (headers,
  credentials, error UX) settles.
- **No build-time URL derivation.** Other frameworks (Next App
  Router, RSC) auto-generate stable URLs from function identity via
  bundler magic. That magic requires a build pipeline integration
  Purity doesn't have yet. Explicit URLs are clear, debuggable, and
  trivially serialize across deploys.
- **No client-bundle handler-body stripping.** Bundler-side scrubbing
  of `serverAction(…)` calls from client bundles is a Vite plugin
  follow-up. Phase 1's contract: action handlers must live in
  server-only modules. Users keep them under a `server/`
  directory or a `*.server.ts` naming convention so an
  accidental client import is visible.

## Consequences

**Positive:**

- Single primitive covers progressive enhancement, programmatic
  fetches, and direct test invocation. Same handler shape for all
  three.
- ~50 LOC of implementation. Tree-shakable when unused.
- Pure Web Platform contract — `Request` in, `Response` out. Same
  on Node 18+, Bun, Deno, Cloudflare Workers, Vercel Edge.
- Composes cleanly with shipped primitives: action handlers can
  call `renderToString` to return rendered HTML, redirect after
  mutation, or set cookies the next SSR pass will read via
  `getRequest()` (ADR 0009).

**Negative:**

- Process-global registry. `serverAction()` calls during multi-
  tenant boot order can interact unexpectedly. Vite HMR re-import
  works correctly (last-wins); pure cold-boot is fine; warm-boot
  module-evaluation order in something like an ESM bundler is the
  one place to be careful.
- No transport security primitives. Users wire their own CSRF +
  origin check. Documented, but it's a foot-gun if forgotten.
- No client-bundle safety. Importing a `serverAction()`-containing
  module from client code ships the handler body to the browser.
  Phase 1 leans on convention (server-only filename).
- The handler signature being `(Request) => Response` is universal
  but verbose for the common "parse formData, do thing, redirect"
  case. A future helper could collapse boilerplate; not core scope.

**Neutral:**

- Five exports added (`serverAction`, `findAction`, `handleAction`,
  - two types). Tree-shaken when unused.
- Action URLs collide with route URLs in the user's `matchRoute`
  table — users put actions under `/api/` or another disambiguating
  prefix. Convention, not enforced.
- The dispatcher (`handleAction`) is on the user's hot path —
  pre-empts SSR when a handler matches. Cheap: one `Map.get`.

## Alternatives considered

**Auto-derive the URL from the function via bundler magic (Next
App Router style).** Rejected for Phase 1: requires a Vite plugin
pass that detects `serverAction(fn)` (no URL string), assigns a
build-time stable ID, swaps in a wire-shape proxy on the client.
Substantial integration work; explicit URLs work today.

**Provide an `action.invoke(formData)` client helper.** Six lines of
`fetch` boilerplate isn't worth abstracting until the call site's
needs are well-understood (error UX, optimistic updates, response
shape). Users currently use the `lazyResource` primitive for
imperative POSTs — composable, race-safe, no new surface.

**Bake CSRF into the framework.** Multiple strategies in production
use (SameSite cookies + double-submit, signed cookies, CSRF
tokens-per-form). Choosing one would push apps off the right
choice for their context. Document the integration point, defer to
focused libraries.

**Use a JSON-RPC-style wire protocol with auto-serialization.**
Wider scope (function signatures, error encoding, batching). Real
benefit only when paired with a build-time codegen pass. Closer to
the design space of Server Components — separate ADR if pursued.

**Make `serverAction` a decorator / Symbol-tagged property on a
class.** Mismatches Purity's functional component model. Plain
function + return value composes everywhere; decorators are TC39
Stage 3 but ergonomically heavy for a five-line primitive.
