# 0006: Streaming SSR with Suspense boundaries

**Status:** Proposed
**Date:** 2026-05-10

## Context

`renderToString` (ADR [0004](./0004-ssr-mvp.md)) is a buffered async API:
the server runs the component, awaits every pending `resource()`, runs a
second pass, and returns the complete HTML string. The whole response
blocks on the slowest fetcher in the tree. For app-shell content next to
slow data, this means TTFB is gated by the worst case rather than the
content the user is waiting for.

Mature SSR frameworks address this with streaming + Suspense: render the
shell synchronously, flush its HTML immediately, leave placeholders for
slow regions, then push out the resolved content as separate chunks once
each fetcher resolves. React (`renderToReadableStream`), Solid (streaming
mode + `<Suspense>`), Astro (streaming with fallback slots), and Qwik
(progressive resumability) all converge on roughly this model.

Purity has the pieces to do it:

1. The SSR codegen already understands "resource is pending" because it
   threads an `SSRRenderContext` through every render pass and collects
   `pendingPromises`. Today the renderer awaits all of them and re-runs;
   tomorrow it can emit a placeholder per pending region and stream the
   resolved HTML when each promise settles.
2. The hydration runtime already knows how to walk markers
   (ADR [0005](./0005-non-lossy-hydration.md)). A streamed-in HTML chunk
   can carry its own marker triplet and hydrate independently.
3. The `<!--[--><!--]-->` markers are content-agnostic — extending them
   with a sibling pair `<!--s:N--><!--/s:N-->` to denote a Suspense
   boundary is a small grammar addition, not a redesign.

The reason we didn't ship streaming with the SSR MVP was scope. Streaming
needs (a) a `ReadableStream`-shaped API on the server, (b) a Suspense
primitive in user space, (c) edge-runtime adapters, and (d) a tiny client
runtime to swap chunks in. Each is small; the assembly is the work.

## Decision (proposed)

**Add a `<Suspense>` boundary primitive and a `renderToStream` server
entry point that flushes the boundary's fallback inline when its
resources are pending, then streams the resolved HTML as later chunks
the client splices in via marker IDs.**

### User-facing API

```ts
import { suspense } from '@purityjs/core';

const App = () => html`
  <main>
    <h1>Hello</h1>
    ${suspense(
      () => html`<aside>${() => slowResource()}</aside>`,
      () => html`<aside class="loading">…</aside>`,
    )}
  </main>
`;
```

`suspense(view, fallback)` is functional, not JSX-tagged. It returns a
value that the SSR codegen recognises (branded SSR HTML, with a
boundary ID). Multiple boundaries can be nested; resolution is per
boundary.

### Server: `renderToStream`

New export from `@purityjs/ssr`:

```ts
export function renderToStream(
  component: ComponentFn,
  options?: { timeout?: number; signal?: AbortSignal },
): ReadableStream<Uint8Array>;
```

Flow:

1. Run the component synchronously. Each `suspense()` call:
   - Captures `view` as a deferred renderer + `fallback` as inline HTML.
   - Allocates a boundary ID `N` (monotonic).
   - Emits `<!--s:N-->FALLBACK_HTML<!--/s:N-->` into the main stream.
   - Registers `view` to be rendered as soon as its resources resolve.
2. Flush the shell as the first chunk. The browser starts painting.
3. For each resolved boundary, render `view` to a string (using the
   existing `renderToString` machinery — a boundary is an SSR sub-tree
   with its own SSRRenderContext) and emit:
   ```html
   <template id="purity-s-N">RESOLVED_HTML</template>
   <script>
     __purity_swap(N);
   </script>
   ```
4. After the last boundary resolves (or `timeout` fires), close the
   stream.

Rejected boundaries emit the fallback as final content + a `console.error`
in the swap script. The boundary's `error()` accessor (per
ADR 0004's resource model) surfaces the rejection reason on the client.

### Client: `__purity_swap(N)` runtime

A ~150-byte function injected into the response (or imported from
`@purityjs/core` and invoked by name). Implementation:

```ts
function __purity_swap(n) {
  const tpl = document.getElementById(`purity-s-${n}`);
  const open = findCommentMarker(`s:${n}`);
  const close = findCommentMarker(`/s:${n}`);
  if (!tpl || !open || !close) return;
  // Replace siblings between open and close with the template's content.
  let cur = open.nextSibling;
  while (cur && cur !== close) {
    const next = cur.nextSibling;
    cur.parentNode.removeChild(cur);
    cur = next;
  }
  close.parentNode.insertBefore(tpl.content, close);
  tpl.remove();
  // If hydration has started for this region, hydrate the swapped content.
  // (See "Hydration interplay" below.)
}
```

The function is stable across boundaries and can be inlined once at the
top of the streamed body.

### Hydration interplay

Three cases:

1. **All boundaries resolve before client JS runs.** The HTML the browser
   parsed is fully resolved. `hydrate()` walks it as today.
2. **Some boundaries are still streaming when client JS runs.** The
   hydrator walks past `<!--s:N-->...<!--/s:N-->` regions as opaque
   subtrees (treating the inner HTML as the "current SSR content" for
   that scope). When the swap script later replaces the fallback with the
   resolved content, it emits a `<!--[-->...<!--]-->` marker pair around
   the new content; if the user's client component still references the
   same Suspense view, the hydrator opportunistically inflates the
   resolved subtree on swap.
3. **The boundary errors mid-stream.** The fallback stays. The user's
   `resource()` `.error()` accessor reports the failure once hydration
   reactivity wires up.

To keep hydration simple in this ADR's MVP, **we hydrate after the
stream closes** — the client waits until the response ends (or until a
configurable budget, e.g. 100ms after `DOMContentLoaded`) before
walking. This sidesteps the in-flight swap interleaving.

### Codegen + runtime additions

| Component                                   | Change                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/core/src/control.ts`              | Add `suspense(view, fallback)` returning a boundary marker (branded SSRHtml + view fn). |
| `packages/core/src/compiler/ssr-runtime.ts` | Add `_h.suspense(viewThunk, fallbackHtml)` → emits boundary markers + registers view.   |
| `packages/core/src/ssr-context.ts`          | Track per-boundary pending sets so settle is per-boundary, not global.                  |
| `packages/ssr/src/render-to-string.ts`      | Refactor: extract a "render one tree, return string + pending boundaries" helper.       |
| `packages/ssr/src/render-to-stream.ts`      | New file. Composes the helper with a `ReadableStream` controller.                       |
| `packages/core/src/hydrate-stream.ts`       | Optional: helper that defers `hydrate()` until the stream closes.                       |
| `packages/core/src/__purity_swap.ts`        | The 150-byte client splice helper. Auto-injected by `renderToStream`.                   |

Bundle delta: `suspense()` adds ~100 bytes to client (registry + accessor).
The swap script is conditionally injected — apps without `suspense()`
calls don't pay it.

## Out of scope

- **Selective hydration timing.** All boundaries hydrate together once
  the stream closes. React 18's per-boundary hydration triggered by user
  interaction is a strictly larger problem (needs event replay).
- **Suspense for client-side navigation transitions.** Applies only to
  initial SSR. Client transitions have a different cadence and would use
  a separate primitive (likely `transition()` or `startTransition`).
- **Per-Suspense code splitting / islands.** The whole tree's JS still
  ships in one chunk. Splitting per boundary needs Vite plugin work and
  a separate ADR.
- **HTTP/2 server push, early hints (103).** Server-config concerns;
  the user's adapter handles these around our `ReadableStream` output.
- **Resumability (Qwik-style).** Streaming + Suspense is hydration-based
  and explicitly contrasts with resumability. The framework's reactive
  graph is set up at hydration time, not lazily on interaction.

## Consequences

**Positive:**

- TTFB no longer gates on the slowest resource. The shell paints
  immediately; slow regions show their fallback first and resolve
  progressively.
- The user-facing API is one new function (`suspense`) and one new
  server entry (`renderToStream`). Existing code keeps working —
  `renderToString` stays as the buffered-output entry.
- Reuses the marker grammar and hydration walker (ADR 0005). No new
  parser modes, no second AST.
- Graceful fallback when the stream is consumed by a non-streaming
  client (e.g. crawler, no-JS browser): each chunk is valid HTML, so
  the rendered page is consistent at every flush boundary.

**Negative:**

- `renderToStream` needs an edge-runtime adapter story.
  `ReadableStream<Uint8Array>` works in modern Node (18+), Cloudflare
  Workers, Deno, and the Web platform — but pre-Node 18 users (who can
  still run `renderToString`) are cut off from streaming. Acceptable
  given the shipping ecosystem.
- The browser must execute the inline `__purity_swap(N)` script as
  chunks arrive. Strict CSP setups need a nonce attribute on the
  injected `<script>`. Adds a `nonce` option to `renderToStream`.
- Per-boundary error handling is more nuanced than `renderToString`'s
  whole-render error. A failure inside one boundary doesn't fail the
  response. Needs a clear `onBoundaryError` hook so users can log
  per-region failures.
- The Custom Element + DSD interaction needs care: a `<template
shadowrootmode>` inside a streamed Suspense boundary is parsed by the
  browser when the swap inserts it, not when the original shell parses.
  Browsers handle this correctly per the DSD spec (the shadow root is
  attached when the host element is parsed), but the timing differs from
  buffered SSR. The component's `connectedCallback` runs at
  swap time, not at initial parse.

**Neutral:**

- The buffered `renderToString` stays — no breaking change. It becomes
  the right choice for static prerender and for response sizes small
  enough that streaming gains nothing.
- Resource cache priming (`<script id="__purity_resources__">`) needs a
  per-boundary variant: the script for resolved-boundary resources is
  emitted at swap time, not in the shell.
- Test infrastructure needs a `ReadableStream` consumer harness; the
  existing string-comparison tests won't fit. Add a small
  `streamToString` helper in test utilities.

## Implementation plan

Phases, each landable as its own PR:

1. ✅ **`suspense()` primitive + boundary markers in SSR output.** Shipped.
   No streaming — `suspense(view, fallback)` runs view inline with a
   try/catch, wraps the rendered region in `<!--s:N--><!--/s:N-->`
   markers (N from a per-render counter on `SSRRenderContext`), and the
   client `inflateDeferred` strips those markers before walking the
   inner template. Validates the marker grammar end-to-end.
2. ✅ **Per-boundary timeouts.** Shipped. `suspense(view, fallback,
{ timeout })` records a wall-clock deadline anchored to the first
   pass that encounters the boundary; the renderer's await loop races
   pending promises against the soonest deadline and marks the
   boundary timed-out when its deadline fires first. The next pass
   sees the mark and emits the fallback. Sibling boundaries continue
   resolving normally, so a slow region can't hang the rest of the
   page. Implementation note: this Phase took the simpler path of
   sharing one global pendingPromises set and racing per-boundary
   deadlines against it, rather than refactoring to a per-boundary
   pending stack — outcome is equivalent for the buffered render
   model and far less invasive.
3. ✅ **`renderToStream` MVP.** Shipped. New server entry returning
   `ReadableStream<Uint8Array>` from `@purityjs/ssr`. The shell renders
   via the existing multi-pass loop (top-level resources still block
   the shell — wrap async data in `suspense()` to defer it); each
   `suspense()` call emits its fallback wrapped in `<!--s:N-->...
      <!--/s:N-->` markers and queues `(view, fallback)` into the new
   `streamingBoundaries` map on `SSRRenderContext`. After the shell
   flushes, the renderer drains the queue in declaration order: each
   boundary renders in its own SSRRenderContext + multi-pass loop with
   its own `{ timeout }` budget, then emits a `<template id="purity-s-N">
resolved</template><script>__purity_swap(N)</script>` chunk. The
   ~330-byte swap helper inlines exactly once at the shell tail when
   any boundaries are queued. Hydration timing remains "defer until
   stream close" per the original plan; selective per-boundary
   hydration is left for a follow-up. Per-boundary resource-cache
   serialisation is Phase 6 second-half — boundaries currently refetch
   on the client.
4. ✅ **Edge-runtime adapter examples.** Shipped.
   `examples/ssr-stream-cf-workers/`, `examples/ssr-stream-vercel-edge/`,
   and `examples/ssr-stream-deno/` each show a single-file edge entry
   that wires `renderToStream` into the runtime's standard
   `Request → Response` handler. No adapter code lives in core — all
   three runtimes already speak `ReadableStream<Uint8Array>`, so the
   wiring is one `new Response(stream, …)` call. Each example uses
   `req.signal` so a client disconnect cancels the renderer mid-stream;
   each README documents CSP nonce propagation and the streaming wire
   format users should expect to see on the wire.
5. ✅ **Per-boundary error handling + `onError` hook.** Shipped (a
   subset of full Phase 5 — covers `suspense({ onError })` for view /
   fallback / timeout phases). Per-boundary `__purity_resources__`
   emit landed with Phase 6.
6. ✅ **CSP nonce support + `__purity_resources__` per-boundary emit.**
   Both halves shipped. CSP `nonce` propagates through every inline
   `<script>` we emit (resource cache, swap helper, per-boundary swap
   calls, per-boundary cache primes). Per-boundary cache emits as
   `<script type="application/json" id="__purity_resources_N__">
{"keyed":{...}}</script>` next to each `<template id="purity-s-N">`.
   Only the keyed map is serialised — positional indices inside a
   boundary collide with the shell's index space, so streamed
   boundaries' resources should opt into `resource(..., { key })`. The
   client-side hydrate priming scans `script[id^="__purity_resources_"]`
   and merges all keyed payloads into the cache before priming.

Each phase has its own test + docs requirements; ADRs may follow if any
phase reveals decisions that contradict this plan.

## Alternatives considered

- **Skip streaming, ship Server Components / Resumability instead.**
  Both are larger architectural shifts. RSC requires a server-component
  module boundary the framework doesn't have. Resumability requires
  serializing the full reactive graph into HTML attributes, which
  conflicts with our minimal-output ethos. Streaming is the smallest
  meaningful step from the current SSR model.
- **Use chunked transfer encoding directly without a `ReadableStream`
  abstraction.** Forces a Node-only API; cuts off Cloudflare Workers
  and Deno. `ReadableStream<Uint8Array>` is the platform standard now.
- **Embed boundary IDs as data-attributes on a wrapper element instead
  of comment markers.** Wrapper elements pollute the user's CSS / DOM
  query-selector space. Markers are zero-weight in the rendered tree
  and consistent with the existing slot grammar.
- **Make Suspense automatic — every `resource()` is implicitly its own
  boundary.** Two problems: (a) authors lose control over the
  fallback shape, and (b) per-resource boundaries flood the HTML with
  marker triplets. Explicit `suspense(view, fallback)` matches the
  user's intent.
- **Stream the entire render call as a single `ReadableStream` chunk
  (i.e. just buffer + push).** Defeats the purpose. Real benefit comes
  from flushing the shell before fetchers resolve.
