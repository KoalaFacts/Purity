# @purityjs/ssr

[![npm version](https://img.shields.io/npm/v/@purityjs/ssr.svg)](https://www.npmjs.com/package/@purityjs/ssr)
[![npm downloads](https://img.shields.io/npm/dm/@purityjs/ssr.svg)](https://www.npmjs.com/package/@purityjs/ssr)
[![license](https://img.shields.io/npm/l/@purityjs/ssr.svg)](../../LICENSE)

Server-side rendering for Purity. Renders components to an HTML string, awaits async `resource()` data, primes the client cache, supports Custom Elements via Declarative Shadow DOM, and (since 0.1) ships a streaming entry with `<Suspense>` boundaries for progressive flush.

```ts
import { renderToString, html } from '@purityjs/ssr';

const out = await renderToString(() => html`<h1>Hi</h1>`, { doctype: '<!doctype html>' });
//   → '<!doctype html><h1>Hi</h1>'
```

## Install

```bash
npm install @purityjs/ssr
```

`@purityjs/ssr` has a peer dependency on `@purityjs/core`. Node 18+, Bun, Deno, Cloudflare Workers, and Vercel Edge are all supported runtimes — anything with `ReadableStream<Uint8Array>` and `TextEncoder`.

## Module surface

| Export                                | Kind     | Purpose                                                                                                                                |
| ------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `html`                                | function | Server counterpart of `@purityjs/core`'s `html` — returns a branded `SSRHtml` string instead of building DOM. Drop-in API replacement. |
| `renderToString(component, options?)` | function | Buffered render. Returns `Promise<string>` with `<script id="__purity_resources__">` cache prime appended.                             |
| `renderToStream(component, options?)` | function | Progressive render. Returns `ReadableStream<Uint8Array>` that flushes the shell first, then per-`suspense()` boundary chunks.          |
| `RenderToStringOptions`               | type     | Options for `renderToString` (timeout, doctype, nonce, serialize toggle).                                                              |
| `RenderToStreamOptions`               | type     | Options for `renderToStream` (timeout, doctype, nonce, serialize toggle, AbortSignal).                                                 |
| `SSRHtml`                             | type     | Branded string `{ __purity_ssr_html__: string }` — emitted by `html` and the `*SSR` control-flow helpers.                              |

Every export is re-exported from `@purityjs/ssr`'s root entry. There are no subpaths.

## When to use which entry

| Scenario                                                 | Entry            |
| -------------------------------------------------------- | ---------------- |
| Static prerender (build-time, sitemap)                   | `renderToString` |
| Small response, no slow data                             | `renderToString` |
| Edge function with one-shot HTML reply                   | `renderToString` |
| Slow data behind a fast shell (dashboards, app listings) | `renderToStream` |
| Multiple independent slow regions                        | `renderToStream` |
| Want progressive paint on a slow connection              | `renderToStream` |

## API

### `html`

Identical signature to `@purityjs/core`'s `html`, but its compiled factory emits **HTML strings** rather than DOM nodes. Returns `SSRHtml`.

```ts
import { html } from '@purityjs/ssr';

const greeting = (name: string) => html`<h1>Hello, ${name}</h1>`;
greeting('Ada').__purity_ssr_html__;
//   → '<h1>Hello, <!--[-->Ada<!--]--></h1>'
```

The `<!--[-->VALUE<!--]-->` marker pair brackets every `${expression}` slot. The client-side hydrator walks these markers and binds reactivity in place — see [ADR 0005](../../docs/decisions/0005-non-lossy-hydration.md).

In a Vite SSR build, the `@purityjs/vite-plugin` AOT-compiles `html\`\``calls directly to the SSR factory output and the runtime`html` function is not invoked. It still ships for unit tests and for ad-hoc SSR-without-Vite scripts.

### `renderToString(component, options?)`

```ts
function renderToString(component: () => unknown, options?: RenderToStringOptions): Promise<string>;

interface RenderToStringOptions {
  /** Maximum ms to wait for pending resources during render. Default 5000. */
  timeout?: number;
  /** Inline a JSON snapshot of resolved resources. Default true. */
  serializeResources?: boolean;
  /** Optional doctype prefix (e.g. `'<!doctype html>'`). */
  doctype?: string;
  /** Strict-CSP nonce, base64 / URL-safe characters. */
  nonce?: string;
}
```

**Resolution loop.** Renders the component, awaits any `resource()` fetchers triggered during the pass, re-runs, and repeats until the render is quiescent (no new pending promises) or `timeout` ms elapse. Throws on timeout. `MAX_PASSES = 10` — a render that creates new resources on every pass diverges and throws.

**Resource cache.** When `serializeResources !== false` and at least one `resource()` resolved during the render, the output ends with:

```html
<script type="application/json" id="__purity_resources__">
  …
</script>
```

The client-side `hydrate()` reads this script, calls `primeHydrationCache(...)`, and `resource()` calls inside the hydrating component consume cached values without re-fetching. The payload shape is:

- `[v0, v1, …]` (positional) when no resource opted into a stable key.
- `{ ordered: [...], keyed: { ...} }` when at least one `resource(..., { key })` is in play. Recommended for production code — positional indexing shifts under conditional resource creation.

**Custom Elements.** Components registered via `component('p-tag', …)` SSR through Declarative Shadow DOM:

```html
<p-card>
  <template shadowrootmode="open">
    <style>
      …
    </style>
    <div class="card">…</div>
  </template>
</p-card>
```

Browsers since 2024 (Chrome 124+, Safari 16.4+, Firefox 123+) parse the inline shadow root immediately. `connectedCallback` then hydrates against it. ADR [0004](../../docs/decisions/0004-ssr-mvp.md) covers the contract; pre-2024 browsers fall through to client-only render.

### `renderToStream(component, options?)`

```ts
function renderToStream(
  component: () => unknown,
  options?: RenderToStreamOptions,
): ReadableStream<Uint8Array>;

interface RenderToStreamOptions {
  /** Per-boundary resource timeout. Default 5000. */
  timeout?: number;
  /** Inline shell-resolved resources. Default true. */
  serializeResources?: boolean;
  /** Optional doctype prefix. */
  doctype?: string;
  /** Strict-CSP nonce applied to every inline `<script>` we emit. */
  nonce?: string;
  /** Abort mid-stream — closes the controller and drops in-flight boundary renders. */
  signal?: AbortSignal;
}
```

**Wire format.** The stream emits, in order:

1. The `doctype` prefix, if supplied.
2. The shell HTML — every `suspense(view, fallback)` call emits its **fallback** HTML wrapped in `<!--s:N-->FALLBACK<!--/s:N-->` markers. Top-level resources still block the shell via the multi-pass loop; wrap async data in `suspense()` to defer it.
3. `<script type="application/json" id="__purity_resources__">…</script>` with shell-resolved resources (suppressible via `serializeResources: false`).
4. `<script>window.__purity_swap = …</script>` — the ~330-byte client splice helper, inlined exactly once when there is at least one queued boundary.
5. Per boundary, in declaration order:
   ```html
   <template id="purity-s-N">RESOLVED_HTML</template>
   <script>
     __purity_swap(N);
   </script>
   ```
6. The stream closes when the queue drains (or `signal` aborts).

`__purity_swap(N)` walks the document's comment nodes via `TreeWalker` to find the matching `<!--s:N-->` / `<!--/s:N-->` pair, removes the fallback nodes between them, and inserts the template's content in place. ADR [0006](../../docs/decisions/0006-streaming-suspense.md) Phase 3.

**Per-boundary budgets.** Each boundary renders in its own `SSRRenderContext` with its own multi-pass loop and its own `{ timeout }` budget (the option is per-boundary, not per-response). When a boundary's deadline fires the renderer falls back to its `fallback()` HTML for the streamed chunk — siblings continue resolving normally. Use `suspense({ onError })` to observe view / fallback / timeout phases.

**Per-boundary resource cache.** When a boundary's view resolves any `resource(..., { key })`, the streamed chunk also includes a `<script type="application/json" id="__purity_resources_N__">{"keyed":{…}}</script>` payload alongside the `<template id="purity-s-N">`. On the client, `hydrate()` scans every `script[id^="__purity_resources_"]` and merges the keyed entries before priming — boundary-side keyed resources hit the cache and skip refetching. Positional resources inside a boundary collide with the shell's index space, so streamed-boundary resources should always opt into a key.

**Hydration timing.** The MVP defers `hydrate()` until the stream closes. Selective per-boundary hydration (React-style) is out of scope for now.

## End-to-end recipes

### Node 18+ HTTP server

```ts
// server.ts
import { createServer } from 'node:http';
import { renderToString } from '@purityjs/ssr';
import { App } from './app.js';

createServer(async (req, res) => {
  try {
    const html = await renderToString(App, { doctype: '<!doctype html>' });
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  } catch (err) {
    res.writeHead(500).end('SSR error');
  }
}).listen(3000);
```

### Streaming Node 18+

```ts
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { renderToStream } from '@purityjs/ssr';

createServer(async (req, res) => {
  res.writeHead(200, { 'content-type': 'text/html', 'transfer-encoding': 'chunked' });
  const stream = renderToStream(App, { doctype: '<!doctype html>' });
  Readable.fromWeb(stream as any).pipe(res);
}).listen(3000);
```

### Cloudflare Workers / Vercel Edge / Bun / Deno

```ts
import { renderToStream } from '@purityjs/ssr';

export default {
  async fetch(req: Request): Promise<Response> {
    const stream = renderToStream(App, {
      doctype: '<!doctype html>',
      signal: req.signal, // cancel on client disconnect
    });
    return new Response(stream, { headers: { 'content-type': 'text/html' } });
  },
};
```

`ReadableStream<Uint8Array>` is the platform standard — no adapter code needed.

### With `<Suspense>`

```ts
import { html, suspense } from '@purityjs/core';
import { renderToStream } from '@purityjs/ssr';

const App = () => html`
  <main>
    <h1>Hello</h1>
    ${suspense(
      () => html`<aside>${() => slowData()}</aside>`,
      () => html`<aside class="loading">…</aside>`,
      { timeout: 2000, onError: (err, info) => log(info.boundaryId, err) },
    )}
  </main>
`;
```

The shell paints with `<aside class="loading">…</aside>` immediately; when `slowData()` resolves the streamed chunk swaps in `<aside>RESOLVED</aside>`.

### Strict CSP

Generate a nonce per request and pass it through; pair with a `Content-Security-Policy: script-src 'nonce-…'` header so every inline `<script>` we emit (resource cache prime, swap helper, per-boundary swap calls) is allowed under strict CSP.

```ts
import crypto from 'node:crypto';
const nonce = crypto.randomBytes(16).toString('base64');
const stream = renderToStream(App, { nonce });
res.setHeader('content-security-policy', `script-src 'nonce-${nonce}'; default-src 'self'`);
```

`nonce` is validated against `[A-Za-z0-9+/=_-]+` (base64 + URL-safe). An invalid nonce throws synchronously.

## Hydration contract

| What renders the SSR HTML                    | What attaches client behavior      | Where to call it  |
| -------------------------------------------- | ---------------------------------- | ----------------- |
| `renderToString` / `renderToStream` (server) | `hydrate(container, App)` (client) | `entry.client.ts` |

```ts
// entry.client.ts
import { hydrate } from '@purityjs/core';
import { App } from './app.js';

hydrate(document.getElementById('app')!, App);
```

The hydrator:

- Walks `<!--[-->…<!--]-->` slot markers and binds reactivity to existing nodes (no rebuild). ADR 0005.
- Adopts `each()` rows by key via `<!--er:KEY-->row<!--/er-->` per-row markers, and `when()` / `match()` cases via `<!--m:KEY-->view<!--/m-->` boundary markers. Same node references survive across hydration.
- Strips `<!--s:N-->` / `<!--/s:N-->` Suspense markers (or treats them as opaque if a boundary hasn't streamed yet — Phase 3 MVP defers full hydration until the stream closes).
- Falls back to a fresh `mount()` if the SSR DOM diverges structurally from the client template; never crashes the page.
- Optional `enableHydrationWarnings()` logs structural mismatches; opt-in `enableHydrationTextRewrite()` overwrites SSR text content to match the template (ADR [0007](../../docs/decisions/0007-text-rewrite-on-mismatch.md)).

## SSR control-flow helpers

`@purityjs/core` re-exports server variants: `eachSSR`, `whenSSR`, `matchSSR`, `listSSR`. Use them in code that runs on the server only — they emit the same marker grammar the hydrator expects, including encoded keys for per-row / per-case adoption.

```ts
import { html as ssrHtml, renderToString } from '@purityjs/ssr';
import { eachSSR } from '@purityjs/core';

const out = await renderToString(
  () =>
    ssrHtml`<ul>${eachSSR(
      () => items,
      (todo) => ssrHtml`<li>${() => todo().text}</li>`,
      (todo) => todo.id,
    )}</ul>`,
);
```

In a Vite SSR build the plugin auto-rewrites client `each` / `when` / `match` to their SSR variants — you write client code, it transparently emits SSR HTML.

## Marker grammar reference

| Marker                                         | Emitted by             | Purpose                                                         |
| ---------------------------------------------- | ---------------------- | --------------------------------------------------------------- |
| `<!--[-->VALUE<!--]-->`                        | every expression slot  | Hydrator finds reactive bindings without text-coalescing drift  |
| `<!--e-->ROWS<!--/e-->`                        | `eachSSR`              | Outer `each()` boundary                                         |
| `<!--er:KEY-->row<!--/er-->`                   | `eachSSR` per row      | Per-row adoption (KEY is `encodeURIComponent` with `-` → `%2D`) |
| `<!--m:KEY-->view<!--/m-->`                    | `matchSSR` / `whenSSR` | Boundary marker carrying the rendered case key                  |
| `<!--l-->ROWS<!--/l-->`                        | `listSSR`              | Flat single-tag list boundary                                   |
| `<!--s:N-->view<!--/s:N-->`                    | `suspense()`           | Streaming boundary; `N` is the per-render monotonic id          |
| `<template shadowrootmode="open">…</template>` | `component()` SSR      | Declarative Shadow DOM payload for Custom Elements              |

The `<!--[-->` / `<!--]-->` markers are 14 bytes per slot; the cost is fixed and pays for non-lossy hydration.

## Conventions

- **One `pushSSRRenderContext` per render.** Both `renderToString` and `renderToStream` push their own `SSRRenderContext`; user code reads it through `getSSRRenderContext()`. Don't push your own.
- **Async by default.** Both render entries are async (the multi-pass resource loop awaits between passes). `renderToStream` returns the `ReadableStream` synchronously but the `start()` controller is `async`.
- **`html` is two different functions.** `@purityjs/core/html` builds DOM (or returns a deferred-template thunk during hydration). `@purityjs/ssr/html` returns `SSRHtml`. Vite's SSR transform picks the right one per build target — apps written for both targets parametrise the user code on the html tag.
- **Shadow DOM scope.** Components are isolated. Global stylesheets that need to pierce the shadow root use `adoptedStyleSheets` per component; CSS variables work normally. See [`docs/shadow-dom-rationale.md`](../../docs/shadow-dom-rationale.md).
- **Resources need keys for streaming.** Inside a `suspense(view)` view, prefer `resource(..., { key: 'unique-string' })` so the per-boundary cache (Phase 6 second-half) addresses values stably across the SSR/hydrate boundary.
- **Output is byte-for-byte deterministic** for a fixed input: marker IDs reset per render, resource counters reset per pass, and per-boundary IDs are monotonic. Snapshot tests are reliable.

## Common gotchas

| Symptom                                          | Cause                                                                                                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[Purity] renderToString timed out after 5000ms` | A `resource()` fetcher hangs. Check the network or set `{ timeout: longer }`.                                                                              |
| `did not converge within 10 passes`              | The render creates new resources on every pass. Memoize the resource list or move it out of the render path.                                               |
| Hydration mismatch — `<p>` vs `<div>`            | SSR and client templates disagree. Run with `enableHydrationWarnings()` in dev.                                                                            |
| Streamed boundary refetches its data on hydrate  | The resources inside the boundary's view aren't keyed. Use `resource(..., { key: 'unique-string' })` — only keyed values get cross-boundary cache priming. |
| `__purity_swap` blocked by CSP                   | Pass `nonce` through both `renderToStream` and your CSP header.                                                                                            |
| Custom Element flickers on hydrate               | Browser doesn't support Declarative Shadow DOM. Pre-2024 browsers fall through to client-render — feature-detect or polyfill.                              |

## Decision records

The SSR feature set is documented through ADRs — start here when you need to dig deeper:

- [0004 — SSR MVP](../../docs/decisions/0004-ssr-mvp.md) — `renderToString`, DSD, resource awaiting, lossy hydration baseline.
- [0005 — Marker-walking, non-lossy hydration](../../docs/decisions/0005-non-lossy-hydration.md) — `<!--[-->` slot markers, deferred-template thunks, per-row / per-case adoption.
- [0006 — Streaming + Suspense](../../docs/decisions/0006-streaming-suspense.md) — `<!--s:N-->` boundary grammar, `renderToStream` MVP, `__purity_swap` client splice.
- [0007 — Text-content rewriting on mismatch](../../docs/decisions/0007-text-rewrite-on-mismatch.md) — opt-in self-heal for stale-CDN drift.

## License

MIT
