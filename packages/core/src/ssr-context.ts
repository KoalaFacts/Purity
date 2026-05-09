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
// `<script id="__purity_resources__">` tag emitted by renderToString. Each
// resource() consumes from this array in creation order; once exhausted,
// resources fall back to their normal fetch path.
// ---------------------------------------------------------------------------

let hydrationCache: unknown[] | null = null;
let hydrationCursor = 0;

/** @internal */
export function primeHydrationCache(data: unknown[]): void {
  hydrationCache = data;
  hydrationCursor = 0;
}

/** @internal */
export function consumeHydrationValue(): unknown {
  if (!hydrationCache || hydrationCursor >= hydrationCache.length) return undefined;
  return hydrationCache[hydrationCursor++];
}

/** @internal */
export function clearHydrationCache(): void {
  hydrationCache = null;
  hydrationCursor = 0;
}
