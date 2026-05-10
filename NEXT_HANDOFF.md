# Next handoff — SSR follow-up after the marker-walking + suspense pass

This branch (`claude/next-handoff-task-BE8PV`) closed the bulk of the
SSR gap list called out after ADR 0004 shipped. The remaining items
are either multi-week (streaming) or already documented out-of-scope.
This note captures **what's done, what isn't, and where to start next**
so the next session can pick up cold.

## What shipped on this branch

8 commits, **+2477 / −138** across 24 files, **635 tests passing**
(469 core + 81 ssr + 85 vite-plugin).

| Commit    | Scope                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `d89b32d` | **Marker-walking, non-lossy hydration** — ADR 0005. Walks `<!--[--><!--]-->` SSR markers and binds in place; `DeferredTemplate` thunks for nested `${html\`...\`}`. |
| `8de8ce9` | **Mismatch warnings + ADR 0006 (Proposed)** — `enableHydrationWarnings()` opt-in cursor checks; `hydrate()` catches walker failures and falls back to `mount()`.    |
| `e467ccc` | Recovery test coverage + doc refresh.                                                                                                                               |
| `110ae1a` | **Silent static-text divergence detection** — codegen passes AST text values to the cursor check.                                                                   |
| `a7577f5` | **`suspense()` Phase 1 + CSP nonce** — boundary markers, sync error isolation; `renderToString({ nonce })`.                                                         |
| `7073d29` | **User-controllable `resource()` keys** — closes ADR 0004's cache-shift bug; `{ ordered, keyed }` payload shape.                                                    |
| `65e14df` | **`suspense()` Phase 2 — per-boundary timeouts** — `{ timeout }` option; renderer races deadlines.                                                                  |
| `aa9ec21` | **`suspense()` Phase 5 — `onError` hook** — `{ onError(err, { boundaryId, phase }) }` for view / fallback / timeout.                                                |

ADRs:

- [`0005-non-lossy-hydration.md`](docs/decisions/0005-non-lossy-hydration.md) — Accepted.
- [`0006-streaming-suspense.md`](docs/decisions/0006-streaming-suspense.md) — Proposed; phases 1, 2, 3, 5
  shipped; phases 4 (adapter examples) and 6-half (per-boundary resources) remain.

## What's intentionally not done yet

### 1. _(MVP closed)_ Phase 3 — `renderToStream` + `__purity_swap`

The streaming MVP shipped: `renderToStream(component, options)` returns
a `ReadableStream<Uint8Array>` from `@purityjs/ssr`. Wire format:

1. Doctype prefix (optional)
2. Shell HTML — every `suspense()` call emits its fallback wrapped in
   `<!--s:N-->...<!--/s:N-->`; top-level resources still block the shell
3. `<script id="__purity_resources__">` with shell-resolved data
4. `<script>` inlining `window.__purity_swap = ...` (~330 bytes, once)
5. Per boundary, in declaration order:
   `<template id="purity-s-N">RESOLVED_HTML</template><script>__purity_swap(N)</script>`

`suspense()` checks `ssrCtx.streamingMode`; when set, it skips its
inline `view()` and queues `(view, fallback, onError)` into
`ssrCtx.streamingBoundaries`. `renderToStream` drains the queue after
the shell flushes; each boundary renders in its own SSRRenderContext
(plus its own multi-pass resolution loop) with its own `{ timeout }`
budget.

**Still TODO:**

- **Per-boundary resource cache emit** (Phase 6 second-half). Boundary
  chunks currently don't carry their resolved resources, so the client
  refetches inside the boundary's view on hydrate. Plumbing: each
  boundary's render loop already produces a `resolvedData[]` /
  `resolvedDataByKey` pair; emit them as a per-boundary
  `<script id="__purity_resources_N__">` next to the template, then
  teach `consumeHydrationValue()` to read from the matching id when
  the hydrator enters the boundary's subtree.
- **Edge-runtime adapter examples** (`examples/ssr-stream-cf-workers/`,
  `examples/ssr-stream-vercel-edge/`, `examples/ssr-stream-deno/`).
  No core changes needed — `ReadableStream<Uint8Array>` is platform-
  standard. Each example wires the stream into its runtime's
  `Response`.
- **Selective hydration timing** — currently hydration waits for the
  stream to close (per ADR). React's per-boundary hydration triggered
  by user interaction is a strictly larger problem (event replay) and
  out of scope for now.

**Files added/changed for Phase 3:**

- `packages/core/src/__purity_swap.ts` — client splice helper +
  `PURITY_SWAP_SOURCE` for inlining.
- `packages/core/src/ssr-context.ts` — `streamingMode`,
  `streamingBoundaries` fields.
- `packages/core/src/control.ts` — streaming branch in `suspense()`.
- `packages/ssr/src/render-to-stream.ts` — new entry.
- `packages/ssr/tests/render-to-stream.test.ts` — 10 tests covering
  wire format, ordering, doctype, nonce, timeout fallback, and
  end-to-end swap execution against jsdom.

### 2. _(closed)_ Per-row / per-case reconciliation in `each` / `when` / `match`

All three control-flow helpers now hydrate losslessly.

- `each()` adopts SSR rows by key — `<!--er:K-->row<!--/er-->` markers,
  `DeferredEach` handle, `inflateDeferredEach` adoption helper.
- `when()` / `match()` adopt the SSR-rendered case —
  `<!--m:KEY-->view<!--/m-->` boundary marker, `DeferredMatch` handle,
  `inflateDeferredMatch` adoption helper. The adopted nodes seed the
  per-case DOM cache, so toggling away and back to the SSR key reuses
  the original SSR-derived DOM.

SSR-key / client-key drift in either helper falls through to a fresh
render of the current value, with the surrounding tree preserved.

### 3. _(closed)_ Static text-content rewriting on mismatch

Shipped as [ADR 0007](docs/decisions/0007-text-rewrite-on-mismatch.md):
opt-in `enableHydrationTextRewrite()` flag (off by default). When on,
the hydrator overwrites SSR `Text` node `data` to match the template's
AST text on mismatch — same node reference, only the bytes change.
Independent of warnings; combine the two flags for fix-and-log.

### 4. Framework-level features

These aren't really SSR gaps — they're standalone framework features
that need their own ADR. None of them blocks ADR 0004's "SSR MVP"
contract.

- **File-system routing + nested layouts** — no equivalent to SolidStart / SvelteKit / Next App Router.
- **Server actions / RPC + progressive form enhancement** — Remix/SvelteKit style.
- **Head / meta tag management** — no `<Title>` / `<Meta>` API; users write the shell HTML by hand.
- **Request context** — components can't read cookies/headers/URL during SSR.
- **SSG / ISR / PPR** — `renderToString` is the primitive; needs a build-time / per-route driver on top.
- **DSD fallback for pre-2024 browsers** — out of scope per ADR 0004.

### 5. Phase 6 second-half — per-boundary `__purity_resources__` emit

Now unblocked: Phase 3 streaming shipped. Each streamed boundary chunk
should carry its own `resolvedData` / `resolvedDataByKey` payload so
the client doesn't refetch inside the boundary on hydrate. Hook point
is `renderBoundary()` in `packages/ssr/src/render-to-stream.ts` — the
loop already collects `resolvedData[]` per boundary; emit it as a
`<script type="application/json" id="__purity_resources_N__">` next to
each `<template id="purity-s-N">` and teach `consumeHydrationValue()`
to read from the matching id when the hydrator enters the boundary's
subtree.

## Test count by package (post-branch)

```
core         469 passing  (18 files)  — was 451 before this branch
ssr           81 passing  ( 6 files)  — was 52
vite-plugin   85 passing  ( 7 files)  — unchanged
total        635
```

New test files:

- `packages/core/tests/hydrate-mismatch.test.ts` — opt-in warnings + fallback recovery.
- `packages/ssr/tests/hydrate-parity.test.ts` — end-to-end SSR → hydrate identity preservation.
- `packages/ssr/tests/suspense.test.ts` — Phase 1 / 2 / 5 coverage.

## Files most worth re-reading before the next session

- `packages/core/src/compiler/hydrate-runtime.ts` — the deferred-thunk + warnings runtime.
- `packages/core/src/compiler/codegen.ts` — `generateHydrate(ast)` cursor walker.
- `packages/core/src/control.ts` — `suspense()` (lines ~1040–1180).
- `packages/ssr/src/render-to-string.ts` — boundary deadline race in the await loop.
- `packages/core/src/ssr-context.ts` — both cache stores (positional + keyed).

## Recommended next sprint

If you have a session-or-more of focus to spend: **start ADR 0006
Phase 3 (streaming)**. Outline:

1. Sketch the wire format end-to-end on paper first — what does the
   response body look like for a 2-boundary page with one slow boundary?
2. Implement `renderToStream(component, options)` returning
   `ReadableStream<Uint8Array>`. Reuse `renderToString`'s helpers;
   the new piece is the controller + the `__purity_swap` injection.
3. Add a single end-to-end SSR-stream test before adding adapter
   examples — the ADR's "Hydration interplay" section is the
   trickiest part and benefits from real bytes through a real stream.
4. The hydration-defer-until-stream-close MVP is fine; per-boundary
   selective hydration can be a follow-up ADR.

If you have less time: **ship per-row reconciliation in `each()`** —
real visible improvement for table-heavy apps, contained scope.
