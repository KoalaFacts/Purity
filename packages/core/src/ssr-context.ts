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
}

let currentContext: SSRRenderContext | null = null;

/** @internal */
export function getSSRRenderContext(): SSRRenderContext | null {
  return currentContext;
}

/** @internal */
export function pushSSRRenderContext(ctx: SSRRenderContext): void {
  currentContext = ctx;
}

/** @internal */
export function popSSRRenderContext(): void {
  currentContext = null;
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
      obj.keyed && typeof obj.keyed === 'object' ? (obj.keyed as Record<string, unknown>) : null;
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
