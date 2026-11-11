# 0062: Independent progress for streamed Suspense boundaries

**Status:** Proposed (SV2-009; implementation slices tracked in
[the surpass-Solid ledger](../plans/surpass-solid.md))
**Date:** 2026-11-08

## Context

`renderToStream()` (ADR [0006](./0006-streaming-suspense.md)) flushes the
shell with every `suspense()` fallback, then renders the deferred views one
after another and emits their chunks in declaration order. A fast sidebar
declared after a slow feed waits for the feed: its view does not even start
until the feed's chunk has been written
([SV2-009](../solid-v2-gap-analysis.md#sv2-009)). Solid v2's streaming
renderer flushes boundary fragments as they settle. The existing stream also
promises backpressure (a view starts only when the consumer has room),
per-boundary deadlines, request abort and bounded buffering; those must hold.

## Decision

1. `RenderToStreamOptions.boundaryConcurrency?: number` (also accepted by
   `renderToStreamResponse()`). Default `1`, which is ADR 0006's behaviour
   exactly: one view at a time, chunks in declaration order.
2. With `n > 1` (or `Infinity`), up to `n` deferred views render at once.
   Each chunk (`<template id="purity-s-N">`, its keyed resource script and
   `__purity_swap(N)`) is emitted as soon as its view settles — ready, thrown
   (fallback chunk), timed out (fallback chunk) or skipped. The swap helper
   addresses boundaries by id, so out-of-order chunks need no client change.
3. Views are started only when the producer runs, i.e. after the consumer
   pulled. While the consumer is paused, at most `n` views are in flight and
   at most `n` rendered chunks wait in memory. `n` is the memory bound the
   application chooses; it is not a default.
4. Each boundary keeps its own render session, `onError` reporting and the
   deadlines ADR 0006 gives it (the `suspense({ timeout })` clock from the
   shell, the renderer `timeout` from when its view starts).
5. Consumer cancel or request/`signal` abort aborts every in-flight view;
   their late settlement writes nothing and no chunk follows.
6. Invalid values (non-number, `< 1`, non-integer finite numbers, `NaN`) throw
   before any user code runs, like the other render-option checks.

### Intentional differences from Solid

- Opt-in, not the default: existing streams keep their byte order, and
  applications choose their own buffering bound.
- No `Reveal`-style ordering groups in this slice; ordering between sibling
  boundaries is either declaration order (`1`) or natural progress (`n > 1`).

## Acceptance tests

`packages/ssr/tests/stream-concurrency.test.ts` (direct and prepared
streams): a fast second sibling is flushed while the first is still pending;
the default keeps declaration order; with 16 large views and
`boundaryConcurrency: 3` at most 3 views start while the consumer is paused;
a throwing sibling and a ready sibling are flushed before a timed-out one,
which still reports `onError(undefined, { phase: 'timeout' })`; consumer
cancel and external abort drop every in-flight view and leave no timers;
invalid values are rejected. The existing `stream-backpressure.test.ts` and
`render-to-stream.test.ts` suites stay unchanged and green.

## Consequences

- Pages with independent slow regions can paint each region when it is
  ready instead of in source order.
- Later slices (ledger SV2-009): nested boundaries streamed independently
  (today nested `suspense()` inside a deferred view renders inline), reveal
  ordering groups, and SV2-010 early interactivity built on out-of-order
  chunks.

## Alternatives considered

- Make natural progress the default — rejected: it changes the wire order of
  every existing stream and the memory bound becomes implicit.
- Render every deferred view eagerly after the shell — rejected: ignores
  consumer backpressure and buffers every chunk.
