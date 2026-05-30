// ---------------------------------------------------------------------------
// SSR context — cross-cutting state used by `renderToString` to coordinate
// async resources during server render and to prime the client-side
// resource cache after hydration.
//
// Shape:
//   pendingPromises  — fetchers fired during this render pass that are still
//                       in flight; renderToString awaits them between passes
//   resolvedData     — values resolved during prior passes, indexed by the
//                       creation order of resource() calls
//   resourceCounter  — monotonic counter incremented per resource() call
//                       within the current pass; the index into resolvedData
// ---------------------------------------------------------------------------

export interface SSRRenderContext {
  pendingPromises: Promise<unknown>[];
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
   * Monotonic per-render counter for `suspense()` boundary IDs. Reset to
   * zero at the start of each pass so IDs are stable across the two-pass
   * resource-resolution loop. Used by the boundary-marker grammar
   * `<!--s:N--><!--/s:N-->` so streaming (ADR 0006 Phase 3) can address
   * each boundary by its position-stable ID.
   */
  suspenseCounter: number;
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
}

// A real LIFO stack — earlier versions held a single-slot `currentContext`,
// so a nested `pushSSRRenderContext` from inside another render (e.g. a
// streaming boundary re-entering a render pass, or any inner SSR call site
// that pushes its own context) clobbered the outer caller's context and a
// subsequent `popSSRRenderContext` unconditionally nulled it. The stack
// shape preserves LIFO save/restore semantics so nested/concurrent SSR
// scopes can coexist. `getSSRRenderContext` reads the top of the stack.
const contextStack: SSRRenderContext[] = [];

/** @internal */
export function getSSRRenderContext(): SSRRenderContext | null {
  return contextStack.length === 0
    ? null
    : (contextStack[contextStack.length - 1] as SSRRenderContext);
}

/** @internal */
export function pushSSRRenderContext(ctx: SSRRenderContext): void {
  contextStack.push(ctx);
}

/** @internal */
export function popSSRRenderContext(): void {
  // No-op on an empty stack — defensive against stray pops (e.g. an outer
  // `finally` running after a callee already popped the same frame). Was
  // previously a silent overwrite-to-null, which had the same effect.
  contextStack.pop();
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

// ---------------------------------------------------------------------------
// Client-side hydration cache — primed by `hydrate()` from the
// `<script id="__purity_resources__">` tag emitted by renderToString.
//
// Two parallel stores:
//   * `hydrationCache` (positional) — consumed in creation order. Used by
//     resources that didn't opt into a stable key. Best-effort: shifts
//     under conditional resource creation (the long-standing limitation
//     called out in ADR 0004).
//   * `hydrationCacheByKey` (keyed) — looked up by the user-supplied
//     `key` option on `resource()`. Stable across reorders / conditionals;
//     the recommended path for any resource whose creation isn't
//     unconditional.
// ---------------------------------------------------------------------------

let hydrationCache: unknown[] | null = null;
let hydrationCursor = 0;
let hydrationCacheByKey: Record<string, unknown> | null = null;

// Null-prototype copy so `key in hydrationCacheByKey` can't match prototype
// methods (`constructor`, `toString`, `__proto__`, `hasOwnProperty`, …) for
// a user-supplied `key`. JSON.parse always returns prototype-having objects.
function intoNullProto(src: Record<string, unknown>): Record<string, unknown> {
  const dst = Object.create(null) as Record<string, unknown>;
  for (const k of Object.keys(src)) dst[k] = src[k];
  return dst;
}

/**
 * Accept the legacy array shape (`[v0, v1, …]`) or the new object shape
 * (`{ ordered: [...], keyed: {...} }`). Older renderToString output is the
 * array; new output uses the object form when at least one resource opts
 * into a `key`. Defensive against unknown shapes — anything else is
 * treated as "no cache."
 *
 * @internal
 */
export function primeHydrationCache(data: unknown): void {
  hydrationCursor = 0;
  if (Array.isArray(data)) {
    hydrationCache = data;
    hydrationCacheByKey = null;
    return;
  }
  if (data && typeof data === 'object') {
    const obj = data as { ordered?: unknown; keyed?: unknown };
    hydrationCache = Array.isArray(obj.ordered) ? obj.ordered : [];
    hydrationCacheByKey =
      obj.keyed && typeof obj.keyed === 'object'
        ? intoNullProto(obj.keyed as Record<string, unknown>)
        : null;
    return;
  }
  hydrationCache = null;
  hydrationCacheByKey = null;
}

/**
 * Consume the next positional value, or — if `key` is supplied and present
 * in the keyed cache — return that. Returns `undefined` on miss; the
 * caller falls back to fetching normally.
 *
 * @internal
 */
export function consumeHydrationValue(key?: string): unknown {
  if (key !== undefined) {
    if (hydrationCacheByKey && key in hydrationCacheByKey) {
      return hydrationCacheByKey[key];
    }
    return undefined;
  }
  if (!hydrationCache || hydrationCursor >= hydrationCache.length) return undefined;
  return hydrationCache[hydrationCursor++];
}

/** @internal */
export function clearHydrationCache(): void {
  hydrationCache = null;
  hydrationCursor = 0;
  hydrationCacheByKey = null;
}
