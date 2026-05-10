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
- [`0006-streaming-suspense.md`](docs/decisions/0006-streaming-suspense.md) — Proposed; phases 1, 2, 5
  shipped; phases 3, 4, 6-half remain.

## What's intentionally not done yet

### 1. Phase 3 — `renderToStream` + `__purity_swap` (the actual streaming)

**Biggest remaining SSR win.** Multi-week per ADR 0006. Needs:

- A `ReadableStream<Uint8Array>` server entry that flushes the shell
  immediately, then streams `<template id="purity-s-N">` chunks +
  `__purity_swap(N)` calls as boundaries resolve.
- A ~150-byte client splice helper auto-injected into the response
  (`packages/core/src/__purity_swap.ts`).
- Hydration-defer-until-stream-close logic — the simplest path per
  the ADR's "Hydration interplay" section is to wait for the response
  to end before walking, sidestepping in-flight swap interleaving.
- Edge-runtime adapter examples (`examples/ssr-stream-cf-workers/`,
  `examples/ssr-stream-vercel-edge/`, `examples/ssr-stream-deno/`).

**Where to start:** ADR 0006 §"Implementation plan" item 3. The marker
grammar (`<!--s:N--><!--/s:N-->`) is already emitted by `suspense()`;
this phase is the streaming machinery on top of it.

**Open design question:** mid-stream hydration semantics. The ADR
defers it ("hydrate after the stream closes") but a serious user will
want event handlers attached before the slow boundary resolves —
that's React's selective-hydration story. Worth deciding before
shipping Phase 3 whether to follow React's per-boundary hydration
model or keep the simpler defer-everything approach.

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

Tied to Phase 3 streaming. Each streamed boundary chunk would carry
its own resource-cache entries instead of all entries piling into the
shell's single `<script id="__purity_resources__">`. Defer until
Phase 3 lands.

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
