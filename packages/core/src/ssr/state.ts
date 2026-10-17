// Passive SSR context state. Reading it must not import server renderers.

export interface SSRRenderContext {
  pendingPromises: Promise<unknown>[];
  /** In-flight operations reused while another boundary triggers a new pass. @internal */
  pendingResources?: Map<string, Promise<unknown>>;
  /** Resolved fetcher values, indexed by resource() creation order. */
  resolvedData: unknown[];
  /**
   * Errors thrown / rejected by fetchers, indexed alongside resolvedData.
   * Tracked so the second render pass can re-surface them through the
   * resource's `error()` accessor — they would otherwise reset to
   * `undefined` because each pass creates fresh state signals.
   */
  resolvedErrors: unknown[];
  resourceCounter: number;
  /**
   * Resolved fetcher values for resources that opted into a stable user
   * key via `resource(..., { key })`. Survives conditional/reordered
   * resource creation across passes — unlike the index-based
   * `resolvedData`, which shifts when an upstream condition flips.
   */
  resolvedDataByKey: Record<string, unknown>;
  /** Errors keyed alongside resolvedDataByKey. */
  resolvedErrorsByKey: Record<string, unknown>;
  /**
   * Highest `suspense()` ID encountered during this pass. Structural
   * paths keep IDs stable across resource-resolution passes and separate
   * view children from fallback children. Used by the boundary-marker grammar
   * `<!--s:N--><!--/s:N-->` so streaming (ADR 0006 Phase 3) can address
   * each boundary by its position-stable ID.
   */
  suspenseCounter: number;
  /** IDs keyed by parent scope and sibling position, shared across passes. @internal */
  boundaryIds?: Map<string, number>;
  /** Active structural view/fallback path. @internal */
  boundaryPath?: string;
  /** Child positions per structural path, fresh for each render pass. @internal */
  boundaryPositions?: Map<string, number>;
  /**
   * Monotonic per-render counter for `island()` IDs. Reset to zero at the
   * start of each pass so IDs are stable across the two-pass
   * resource-resolution loop. The ID is written into the SSR-emitted
   * `<purity-island data-pi-id="N">` wrapper and consumed by
   * `mountIslands()` on the client to look up the matching view function
   * by position. ADR 0038 Phase 2.
   */
  islandCounter: number;
  /**
   * Wall-clock timestamp (ms) at which each boundary was first
   * encountered. Survives across passes so deadlines stay anchored to
   * pass-1's start, not the pass currently running.
   */
  boundaryStartTimes: Map<number, number>;
  /**
   * Boundary deadlines (ms epoch). Populated when `suspense()` receives
   * a `{ timeout }` option. The outer renderToString await loop races
   * the pending promises against the soonest deadline and marks the
   * boundary timed-out when its deadline fires first.
   */
  boundaryDeadlines: Map<number, number>;
  /**
   * Boundary IDs whose deadline has passed. The next pass's
   * `suspense()` call detects membership and renders the fallback
   * instead of the view.
   */
  timedOutBoundaries: Set<number>;
  /**
   * LIFO stack of boundary IDs currently being rendered. `suspense()`
   * pushes its `id` before invoking `view()` and pops in a finally.
   * `resource()` reads the top of the stack at fetcher-registration
   * time and captures the id alongside the SSR `ssrCtx` reference; its
   * settle path then bails when `ssrCtx.timedOutBoundaries.has(capturedId)`
   * is true — i.e. the surrounding boundary surrendered to its fallback
   * before the fetch settled. Without this, a late-resolving fetcher
   * that wins after the boundary's deadline still mutates the shared
   * `resolvedDataByKey` and corrupts the next pass's render.
   *
   * `timedOutBoundaries` is the same shared `Set` instance across all
   * passes of a single `renderToString` call (declared once in
   * `render-to-string.ts`, threaded onto each pass's ctx). That's why
   * resource() observes the boundary's timeout even though the ctx it
   * captured on pass 1 has been replaced by pass 2's ctx — the Set
   * reference still points at the live timeout-tracker.
   */
  boundaryIdStack?: number[];
  /** Active resource cancellation callbacks, shared across SSR passes. @internal */
  boundaryAborts?: Map<number, Set<(reason: unknown) => void>>;
  /**
   * When true, `suspense()` skips its inline `view()` rendering during
   * the SSR pass, emits the fallback in the shell, and registers the
   * `view` (+ its `fallback` for a re-render on timeout) into
   * {@link streamingBoundaries}. `renderToStream` then drains the map
   * after the shell flush, awaiting each boundary's resources and
   * emitting a `<template id="purity-s-N">resolved</template><script>
   * __purity_swap(N)</script>` chunk per boundary. ADR 0006 Phase 3.
   */
  streamingMode?: boolean;
  /** Boundaries coerced to raw text must finish in the shell, without swaps. @internal */
  inlineBoundaries?: Set<number>;
  /** Removed raw-content occurrences; a reused visible occurrence can still stream. @internal */
  hiddenBoundaries?: Set<number>;
  /**
   * Boundaries deferred for streaming. Populated by `suspense()` when
   * `streamingMode` is on; consumed by `renderToStream` after the
   * shell has been flushed. Insertion order is the boundary's wire
   * order in the response — boundaries stream in the same order they
   * were declared in the source, regardless of resolution order, to
   * keep the wire model deterministic for the simplest MVP.
   */
  streamingBoundaries?: Map<
    number,
    {
      view: () => unknown;
      fallback: () => unknown;
      /** Absolute deadline anchored to the first shell pass. @internal */
      deadline?: number;
      onError?: (err: unknown, info: { boundaryId: number; phase: string }) => void;
    }
  >;
  /**
   * Accumulator for `head()` calls — each entry is a chunk of HTML to
   * append to the document `<head>`. Populated during render; consumed
   * by `renderToString({ extractHead: true })`. ADR 0008.
   */
  head?: string[];
  /**
   * The incoming HTTP request that triggered this render. Optional —
   * passed in via `renderToString({ request })` / `renderToStream({
   * request })`. User components read it through `getRequest()` to
   * branch on URL / headers / method / cookies during SSR. Standard
   * Web Platform `Request` so it works on Node 18+, Bun, Deno,
   * Cloudflare Workers, and Vercel Edge identically. ADR 0009.
   */
  request?: Request;
  /** Cancellation for the active SSR render or stream work. @internal */
  signal?: AbortSignal;
  /** HTTP metadata collected by the active route on the final render pass. */
  routeResponse?: { status?: number; headers: Headers };
}

// A real LIFO stack — earlier versions held a single-slot `currentContext`,
// so a nested `pushSSRRenderContext` from inside another render (e.g. a
// streaming boundary re-entering a render pass, or any inner SSR call site
// that pushes its own context) clobbered the outer caller's context and a
// subsequent `popSSRRenderContext` unconditionally nulled it. The stack
// shape preserves LIFO save/restore semantics so nested/concurrent SSR
// scopes can coexist. `getSSRRenderContext` reads the top of the stack.
/** Shared with the SSR pass owner; not exported by a package entry. @internal */
export const contextStack: SSRRenderContext[] = [];

/** @internal */
export function getSSRRenderContext(): SSRRenderContext | null {
  return contextStack.length === 0
    ? null
    : (contextStack[contextStack.length - 1] as SSRRenderContext);
}

/**
 * Return the innermost active boundary id currently being rendered, or
 * `null` when there is no SSR context or no active boundary. Used by
 * `resource()` to capture the surrounding boundary id at fetcher
 * registration time so its settle path can check
 * `ctx.timedOutBoundaries.has(id)` and bail before mutating the shared
 * resolved-data cache.
 *
 * @internal
 */
export function currentBoundaryId(): number | null {
  const ctx = getSSRRenderContext();
  if (!ctx || !ctx.boundaryIdStack || ctx.boundaryIdStack.length === 0) return null;
  return ctx.boundaryIdStack[ctx.boundaryIdStack.length - 1];
}

/** Cancel a boundary's active resources, including descendants. @internal */
export function cancelSSRBoundary(ctx: SSRRenderContext, id: number, reason: unknown): void {
  ctx.timedOutBoundaries.add(id);
  const callbacks = ctx.boundaryAborts?.get(id);
  if (!callbacks) return;
  ctx.boundaryAborts?.delete(id);
  for (const abort of callbacks) abort(reason);
}

/** Earliest deadline with unfinished resource work. @internal */
export function nextSSRBoundaryDeadline(
  ctx: SSRRenderContext,
): { id: number; deadline: number } | undefined {
  let next: { id: number; deadline: number } | undefined;
  for (const [id, deadline] of ctx.boundaryDeadlines) {
    if (ctx.timedOutBoundaries.has(id) || !ctx.boundaryAborts?.get(id)?.size) continue;
    if (!next || deadline < next.deadline) next = { id, deadline };
  }
  return next;
}
